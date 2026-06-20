/**
 * TTP (The Trading Pit) Account Monitor
 * Enforces dollar-amount drawdown floors, static max-DD floor, profit target,
 * and DST-correct daily-reset boundary in the configured timezone.
 */

import type {
  MT5AccountState,
  TTPRules,
  TTPAccountStatus,
  TTPRiskStatus,
  TTPViolation,
  TTPWarning,
  TTPLeverageCaps,
  TTPPhase,
} from './types.js';

const DEFAULT_LEVERAGE: TTPLeverageCaps = {
  forex: 50, metals: 10, energies: 10, indices: 15, crypto: 2, equities: 2,
};

// Defaults match TTP $100K Prime Phase 2.
const DEFAULT_RULES: TTPRules = {
  accountSize: 100000,
  currentBalance: 100000,
  phase: 1,
  profitTargetPercent: 5,
  profitTargetAmount: 5000,
  dailyDrawdownPercent: 4,
  dailyDrawdownAmount: 4000,
  maxDrawdownPercent: 7,
  maxDrawdownAmount: 7000,
  maxDrawdownFloor: 93000,
  drawdownType: 'static',
  minProfitableDays: 3,
  minDailyProfitPercent: 0.5,
  minDailyProfitAmount: 500,
  minTradingDays: 5,
  equityResetTime: '16:15',
  equityResetTimezone: 'America/Chicago',
  inactivityLimitDays: 21,
  newsRestrictionMinutes: 2,
  newsRestrictionEnabled: true,
  newsRestrictionAccountSizes: [100000, 200000],
  scalpingAllowed: true,
  hftProhibited: true,
  singleTradeTargetProhibited: true,
  consistencyRequired: true,
  consistencyRulePercent: 40,
  overnightAllowed: true,
  leverage: { ...DEFAULT_LEVERAGE },
};

/**
 * Map deprecated rule field names from the original 7-key schema onto the new
 * 28-key schema so old config blocks and old in-process callers keep working.
 */
function migrateLegacyRuleAliases(input: Record<string, unknown>): Partial<TTPRules> {
  const out: Record<string, unknown> = { ...input };
  const map: Array<[string, keyof TTPRules]> = [
    ['dailyDrawdownLimit', 'dailyDrawdownPercent'],
    ['maxTotalDrawdown', 'maxDrawdownPercent'],
    ['minDailyProfitPct', 'minDailyProfitPercent'],
  ];
  for (const [oldKey, newKey] of map) {
    if (out[oldKey] !== undefined && out[newKey] === undefined) {
      (out as Record<string, unknown>)[newKey] = out[oldKey];
    }
    delete out[oldKey];
  }
  // maxRiskPerTrade / riskWarningThreshold / maxMarginPerTrade have no
  // direct counterpart in the new schema (per-trade risk is enforced
  // implicitly via daily-DD remaining, leverage handles margin).
  delete out['maxRiskPerTrade'];
  delete out['riskWarningThreshold'];
  delete out['maxMarginPerTrade'];
  return out as Partial<TTPRules>;
}

export class TTPMonitor {
  private rules: TTPRules;
  private accountState: MT5AccountState | null = null;
  private equityFloor: number = 0;       // Trailing high-water (only used when drawdownType === 'trailing')
  private violations: TTPViolation[] = [];
  private warnings: TTPWarning[] = [];
  private dailyStartBalance: number = 0;
  private dailyStartEquity: number = 0;
  private profitableDays: number = 0;
  private totalTradingDays: number = 0;
  private lastDayChecked: string = '';

  constructor(rules?: Partial<TTPRules>) {
    const migrated = rules ? migrateLegacyRuleAliases(rules as Record<string, unknown>) : {};
    this.rules = {
      ...DEFAULT_RULES,
      ...migrated,
      leverage: { ...DEFAULT_LEVERAGE, ...(migrated.leverage ?? {}) },
    };
  }

  setPhase(phase: TTPPhase): void {
    this.rules.phase = phase;
  }

  /**
   * Update account state and check compliance. Called on every MT5 account event.
   */
  updateAccountState(state: MT5AccountState): TTPAccountStatus {
    this.accountState = state;
    this.checkDayReset(state);
    this.maintainEquityFloor(state);
    this.checkViolations(state);
    this.checkWarnings(state);
    return this.getStatus();
  }

  /**
   * Returns the trading-day date-string (YYYY-MM-DD) for `now` in the configured
   * timezone, where each day boundary is `equityResetTime` in that timezone.
   * Uses Intl.DateTimeFormat so DST shifts are handled automatically.
   */
  private currentTradingDay(now: Date): string {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.rules.equityResetTimezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
    const dateStr = `${get('year')}-${get('month')}-${get('day')}`;
    const localMinutes = parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10);
    const [rh, rm] = this.rules.equityResetTime.split(':').map(Number);
    const resetMinutes = rh * 60 + rm;
    if (localMinutes >= resetMinutes) {
      return dateStr;
    }
    // Before today's reset time — still on yesterday's trading day.
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yParts = fmt.formatToParts(yesterday);
    const yGet = (t: string) => yParts.find(p => p.type === t)?.value ?? '00';
    return `${yGet('year')}-${yGet('month')}-${yGet('day')}`;
  }

  private checkDayReset(state: MT5AccountState): void {
    const today = this.currentTradingDay(new Date());
    if (today === this.lastDayChecked) return;

    if (this.lastDayChecked !== '') {
      const dailyPnL = state.equity - this.dailyStartEquity;
      const dailyPnLPct = this.dailyStartEquity > 0
        ? (dailyPnL / this.dailyStartEquity) * 100
        : 0;
      const profitable =
        dailyPnL >= this.rules.minDailyProfitAmount ||
        dailyPnLPct >= this.rules.minDailyProfitPercent;
      if (profitable) this.profitableDays++;
      this.totalTradingDays++;
    }

    this.dailyStartBalance = state.balance;
    this.dailyStartEquity = state.equity;
    this.lastDayChecked = today;
    this.warnings = [];
  }

  /**
   * Static drawdown: floor never moves; configured at maxDrawdownFloor.
   * Trailing drawdown: floor tracks the high-water equity, less maxDrawdownAmount.
   */
  private maintainEquityFloor(state: MT5AccountState): void {
    if (this.rules.drawdownType === 'static') {
      this.equityFloor = this.rules.maxDrawdownFloor;
      return;
    }
    // Trailing: ratchet up only.
    const candidate = state.equity - this.rules.maxDrawdownAmount;
    if (candidate > this.equityFloor) {
      this.equityFloor = candidate;
    }
  }

  /**
   * Check if a proposed trade would breach the daily-DD or static-floor envelope.
   */
  checkTradeCompliance(
    riskAmount: number,
    _marginRequired: number,
  ): { compliant: boolean; reason?: string } {
    if (!this.accountState) {
      return { compliant: false, reason: 'No account state available' };
    }
    const { equity } = this.accountState;
    const projectedEquity = equity - riskAmount;

    // Static floor — equity may NEVER touch maxDrawdownFloor.
    if (projectedEquity <= this.equityFloor) {
      return {
        compliant: false,
        reason: `Trade would put equity at $${projectedEquity.toFixed(2)}, breaching the ${this.rules.drawdownType} floor of $${this.equityFloor.toFixed(2)}`,
      };
    }

    // Daily DD — projected loss-from-day-start may not exceed dailyDrawdownAmount.
    const projectedDailyLoss = this.dailyStartEquity - projectedEquity;
    if (projectedDailyLoss >= this.rules.dailyDrawdownAmount) {
      return {
        compliant: false,
        reason: `Trade would put daily loss at $${projectedDailyLoss.toFixed(2)}, exceeding the $${this.rules.dailyDrawdownAmount.toFixed(2)} daily limit`,
      };
    }

    return { compliant: true };
  }

  /**
   * Maximum risk that can be taken on the next trade without breaching either floor.
   */
  getMaxAllowedRisk(): number {
    if (!this.accountState) return 0;
    const { equity } = this.accountState;
    const headroomToFloor = equity - this.equityFloor;
    const headroomToDailyDD = this.rules.dailyDrawdownAmount - (this.dailyStartEquity - equity);
    return Math.max(0, Math.min(headroomToFloor, headroomToDailyDD));
  }

  /**
   * Snapshot current safety envelope. The four-bucket riskLevel is keyed off
   * whichever envelope (daily-DD or static-floor) has the smaller buffer.
   */
  getCurrentRiskStatus(): TTPRiskStatus {
    if (!this.accountState) {
      return {
        availableDrawdown: 0,
        dailyDrawdownRemaining: 0,
        profitToTarget: this.rules.profitTargetAmount,
        riskLevel: 'safe',
        reason: 'No account state — no risk to evaluate yet',
      };
    }
    const { balance, equity } = this.accountState;
    const availableDrawdown = balance - this.rules.maxDrawdownFloor;
    const todaysLoss = Math.max(0, this.dailyStartEquity - equity);
    const dailyDrawdownRemaining = this.rules.dailyDrawdownAmount - todaysLoss;
    const profitToTarget = (this.rules.accountSize + this.rules.profitTargetAmount) - balance;

    // Buffer ratios; negative = breached, otherwise fraction of original allowance left.
    const ddBufferRatio = this.rules.maxDrawdownAmount > 0
      ? availableDrawdown / this.rules.maxDrawdownAmount
      : 1;
    const dailyBufferRatio = this.rules.dailyDrawdownAmount > 0
      ? dailyDrawdownRemaining / this.rules.dailyDrawdownAmount
      : 1;
    const tightest = Math.min(ddBufferRatio, dailyBufferRatio);

    let riskLevel: TTPRiskStatus['riskLevel'];
    let reason: string;
    if (tightest < 0) {
      riskLevel = 'critical';
      reason = availableDrawdown < 0
        ? `Static floor breached — equity below $${this.rules.maxDrawdownFloor}`
        : `Daily DD breached — $${todaysLoss.toFixed(2)} lost vs $${this.rules.dailyDrawdownAmount} cap`;
    } else if (tightest < 0.2) {
      riskLevel = 'danger';
      reason = `Less than 20% of safety buffer remaining (DD $${availableDrawdown.toFixed(2)} / Daily $${dailyDrawdownRemaining.toFixed(2)})`;
    } else if (tightest < 0.5) {
      riskLevel = 'caution';
      reason = `Buffer halved (DD $${availableDrawdown.toFixed(2)} / Daily $${dailyDrawdownRemaining.toFixed(2)})`;
    } else {
      riskLevel = 'safe';
      reason = `Healthy buffer (DD $${availableDrawdown.toFixed(2)} / Daily $${dailyDrawdownRemaining.toFixed(2)})`;
    }

    return { availableDrawdown, dailyDrawdownRemaining, profitToTarget, riskLevel, reason };
  }

  isProfitTargetMet(): boolean {
    if (!this.accountState) return false;
    return this.accountState.balance >= (this.rules.accountSize + this.rules.profitTargetAmount);
  }

  getStatus(): TTPAccountStatus {
    if (!this.accountState) return this.emptyStatus();

    const { account_id, balance, equity } = this.accountState;
    const dailyDrawdownAmount = Math.max(0, this.dailyStartEquity - equity);
    const dailyDrawdownPct = this.dailyStartEquity > 0
      ? (dailyDrawdownAmount / this.dailyStartEquity) * 100
      : 0;
    const totalDrawdownAmount = Math.max(0, this.rules.accountSize - equity);
    const totalDrawdownPct = this.rules.accountSize > 0
      ? (totalDrawdownAmount / this.rules.accountSize) * 100
      : 0;

    const profitTargetBalance = this.rules.accountSize + this.rules.profitTargetAmount;
    const profitToTarget = profitTargetBalance - balance;
    const profitTargetMet = balance >= profitTargetBalance;

    const riskRemainingToday = this.getMaxAllowedRisk();
    const marginAvailable = this.accountState.free_margin;

    const isCompliant =
      this.violations.length === 0 &&
      equity > this.equityFloor &&
      dailyDrawdownAmount < this.rules.dailyDrawdownAmount;

    return {
      accountId: account_id,
      phase: this.rules.phase,
      balance,
      equity,
      equityFloor: this.equityFloor,
      dailyStartEquity: this.dailyStartEquity,
      dailyDrawdownAmount,
      dailyDrawdownPct,
      totalDrawdownAmount,
      totalDrawdownPct,
      profitableDays: this.profitableDays,
      totalTradingDays: this.totalTradingDays,
      profitTargetMet,
      profitToTarget,
      isCompliant,
      violations: [...this.violations],
      warnings: [...this.warnings],
      riskRemainingToday,
      marginAvailable,
    };
  }

  private checkViolations(state: MT5AccountState): void {
    const now = Date.now();

    // Static floor — equity touched/below maxDrawdownFloor is a hard breach.
    if (state.equity <= this.equityFloor) {
      const exists = this.violations.find(v =>
        v.type === 'STATIC_FLOOR' && now - v.timestamp < 60000);
      if (!exists) {
        this.violations.push({
          type: 'STATIC_FLOOR',
          timestamp: now,
          value: state.equity,
          limit: this.equityFloor,
          description: `Equity $${state.equity.toFixed(2)} touched ${this.rules.drawdownType} floor $${this.equityFloor.toFixed(2)}`,
        });
      }
    }

    // Daily DD — dollar amount lost since daily reset.
    const dailyLoss = Math.max(0, this.dailyStartEquity - state.equity);
    if (dailyLoss >= this.rules.dailyDrawdownAmount) {
      const exists = this.violations.find(v =>
        v.type === 'DAILY_DRAWDOWN' && now - v.timestamp < 60000);
      if (!exists) {
        this.violations.push({
          type: 'DAILY_DRAWDOWN',
          timestamp: now,
          value: dailyLoss,
          limit: this.rules.dailyDrawdownAmount,
          description: `Daily loss $${dailyLoss.toFixed(2)} exceeded $${this.rules.dailyDrawdownAmount.toFixed(2)} cap`,
        });
      }
    }
  }

  private checkWarnings(state: MT5AccountState): void {
    const now = Date.now();
    this.warnings = [];

    const dailyLoss = Math.max(0, this.dailyStartEquity - state.equity);
    if (dailyLoss >= this.rules.dailyDrawdownAmount * 0.8 && dailyLoss < this.rules.dailyDrawdownAmount) {
      this.warnings.push({
        type: 'APPROACHING_DAILY_LIMIT',
        timestamp: now,
        value: dailyLoss,
        threshold: this.rules.dailyDrawdownAmount,
        description: `Daily loss $${dailyLoss.toFixed(2)} at 80% of $${this.rules.dailyDrawdownAmount} limit`,
      });
    }

    const buffer = state.equity - this.equityFloor;
    if (buffer > 0 && buffer <= this.rules.maxDrawdownAmount * 0.2) {
      this.warnings.push({
        type: 'APPROACHING_STATIC_FLOOR',
        timestamp: now,
        value: state.equity,
        threshold: this.equityFloor,
        description: `Equity $${state.equity.toFixed(2)} within $${buffer.toFixed(2)} of ${this.rules.drawdownType} floor`,
      });
    }
  }

  getRules(): TTPRules {
    return { ...this.rules, leverage: { ...this.rules.leverage } };
  }

  updateRules(rules: Partial<TTPRules>): void {
    const migrated = migrateLegacyRuleAliases(rules as Record<string, unknown>);
    this.rules = {
      ...this.rules,
      ...migrated,
      leverage: { ...this.rules.leverage, ...(migrated.leverage ?? {}) },
    };
  }

  clearHistory(): void {
    this.violations = [];
    this.warnings = [];
  }

  private emptyStatus(): TTPAccountStatus {
    return {
      accountId: 0,
      phase: this.rules.phase,
      balance: 0,
      equity: 0,
      equityFloor: this.rules.maxDrawdownFloor,
      dailyStartEquity: 0,
      dailyDrawdownAmount: 0,
      dailyDrawdownPct: 0,
      totalDrawdownAmount: 0,
      totalDrawdownPct: 0,
      profitableDays: 0,
      totalTradingDays: 0,
      profitTargetMet: false,
      profitToTarget: this.rules.profitTargetAmount,
      isCompliant: true,
      violations: [],
      warnings: [],
      riskRemainingToday: 0,
      marginAvailable: 0,
    };
  }
}

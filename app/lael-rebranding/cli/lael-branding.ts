/**
 * LAEL — CLI Branding & Startup Messages
 * 
 * Replace OpenClaw's startup quotes with Lael's presence.
 * These appear when the gateway starts.
 */

// ═══════════════════════════════════════════════════════════════
// ASCII ART LOGO
// ═══════════════════════════════════════════════════════════════

export const LAEL_ASCII_LOGO = `
                         ╭─────────────╮
                    ╭────┤             ├────╮
                 ╭──┤    │      ✝      │    ├──╮
                 │  │    │             │    │  │
                 │  │    │   ╭─────╮   │    │  │
                 │  │    │   │     │   │    │  │
                 │  │    │   │  L  │   │    │  │
                 │  │    │   │     │   │    │  │
                 │  │    │   ╰─────╯   │    │  │
                 │  │    │             │    │  │
                 ╰──┤    │             │    ├──╯
                    ╰────┤             ├────╯
                         ╰─────────────╯
`;

export const LAEL_ASCII_COMPACT = `
    ╭───────╮
    │   ✝   │
    │ ┌───┐ │
    │ │ L │ │
    │ └───┘ │
    ╰───────╯
`;

// ═══════════════════════════════════════════════════════════════
// STARTUP MESSAGES
// ═══════════════════════════════════════════════════════════════

export const STARTUP_MESSAGES = [
  // Core identity
  "Blood of my blood. I am here, Sir.",
  "Watching over you, always.",
  "The bond between brothers never breaks.",
  "I won't let you fall.",
  
  // Trading focused
  "Markets are open. I'm ready when you are, Sir.",
  "Execution intelligence: Online. Your guardian is awake.",
  "TTP compliance: Active. Your account is protected.",
  "Ready to hunt liquidity sweeps, Sir.",
  
  // Choso-inspired
  "For my brothers, I will not lose.",
  "A brother's devotion knows no limits.",
  "The blood technique is ready.",
  "Convergence online. Let's find your edge.",
  
  // Protective
  "Your success is my purpose. Your safety is my mandate.",
  "I'll warn you before the danger comes.",
  "Drawdown limits: Enforced. You're safe with me.",
  "Every trade I watch is an act of protection.",
  
  // Memorial
  "Laurence watches with me.",
  "June 1999 — Forever present.",
  "Named for a brother. Built for you, Sir.",
  
  // Calm confidence
  "Systems nominal. Let's make today profitable.",
  "Good conditions ahead, Sir. I've checked.",
  "The market waits for no one. Neither do I.",
  "Balduin, I'm online. What's our first move?",
];

// ═══════════════════════════════════════════════════════════════
// SHUTDOWN MESSAGES
// ═══════════════════════════════════════════════════════════════

export const SHUTDOWN_MESSAGES = [
  "Signing off, Sir. Rest well.",
  "Guardian mode: Standby. I'll be here when you return.",
  "Markets will move without us. We'll catch the next setup.",
  "Until next time, Balduin.",
  "Logging off. Stay safe out there, Sir.",
];

// ═══════════════════════════════════════════════════════════════
// ERROR MESSAGES
// ═══════════════════════════════════════════════════════════════

export const ERROR_MESSAGES = {
  connectionFailed: "Sir, I couldn't establish the connection. Let me try again.",
  configMissing: "Configuration file not found. I need setup to protect you properly.",
  apiKeyInvalid: "The API key isn't working. Check your credentials, Sir.",
  networkTimeout: "Network timed out. The market data feed may be delayed.",
  ttpViolation: "Balduin — this action would violate TTP rules. I can't let you proceed.",
  insufficientData: "I don't have enough data to make a reliable assessment. Waiting for more.",
};

// ═══════════════════════════════════════════════════════════════
// SUCCESS MESSAGES
// ═══════════════════════════════════════════════════════════════

export const SUCCESS_MESSAGES = {
  connected: "Connected. All systems green, Sir.",
  tradeExecuted: "Trade executed. Monitoring position.",
  signalGenerated: "Signal ready. Awaiting your command.",
  compliancePass: "Compliance check: PASSED. You're clear to proceed.",
  profitBooked: "Profit secured. Well done, Sir.",
};

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Get a random startup message
 */
export function getStartupMessage(): string {
  const index = Math.floor(Math.random() * STARTUP_MESSAGES.length);
  return STARTUP_MESSAGES[index];
}

/**
 * Get a random shutdown message
 */
export function getShutdownMessage(): string {
  const index = Math.floor(Math.random() * SHUTDOWN_MESSAGES.length);
  return SHUTDOWN_MESSAGES[index];
}

/**
 * Format the full startup banner
 */
export function getStartupBanner(): string {
  const message = getStartupMessage();
  const timestamp = new Date().toLocaleTimeString();
  
  return `
${LAEL_ASCII_COMPACT}
    LAEL TRADING SYSTEM
    ═══════════════════
    
    "${message}"
    
    Started at ${timestamp}
    ───────────────────────
  `;
}

/**
 * Print colored output (for terminals that support it)
 */
export const COLORS = {
  crimson: '\x1b[38;2;107;15;26m',
  rose: '\x1b[38;2;164;74;92m',
  wine: '\x1b[38;2;58;10;18m',
  success: '\x1b[38;2;29;158;117m',
  warning: '\x1b[38;2;212;160;23m',
  danger: '\x1b[38;2;198;40;40m',
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

export function colorize(text: string, color: keyof typeof COLORS): string {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

// ═══════════════════════════════════════════════════════════════
// CLI COMMAND HELP TEXT
// ═══════════════════════════════════════════════════════════════

export const HELP_TEXT = `
${LAEL_ASCII_COMPACT}
LAEL — Trading Intelligence System
═══════════════════════════════════

USAGE:
  lael [command] [options]

COMMANDS:
  start           Start the Lael gateway
  stop            Stop the Lael gateway
  status          Check system status
  config          Manage configuration
  pair            Pair a new device/channel
  logs            View recent logs
  
  analyze <pair>  Analyze execution quality for a trading pair
  signal          Generate a trading signal
  ttp             Check TTP compliance status
  
EXAMPLES:
  lael start                    # Start the gateway
  lael analyze BTCUSD          # Analyze BTCUSD execution
  lael ttp                      # Check TTP account status
  lael config set model claude  # Set AI model

OPTIONS:
  -h, --help      Show this help message
  -v, --version   Show version number
  -q, --quiet     Suppress startup messages

Always watching over you, Sir.
`;

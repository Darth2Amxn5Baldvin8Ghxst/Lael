//+------------------------------------------------------------------+
//|                                          Lael_DataRelay_EA.mq5   |
//|              Relays MT5 account state and trade events to Lael   |
//|              gateway, and (optionally) gates trades on TTP rules.|
//|                                                                  |
//|              Blood of my blood. Always watching over you, Sir.   |
//|              Named for Laurence - June 1999 - Forever.           |
//+------------------------------------------------------------------+
#property copyright "Lael Trading System"
#property link      "http://127.0.0.1:18789"
#property version   "1.00"
#property strict

//--- inputs
input string LaelEndpoint           = "http://127.0.0.1:18789"; // Gateway base URL
input int    UpdateIntervalSeconds  = 30;                       // Account heartbeat cadence
input bool   EnablePreTradeCheck    = false;                    // POST /api/mt5/check before fills
input int    HttpTimeoutMs          = 5000;                     // Per-request timeout
input bool   VerboseLogging         = true;                     // Log every request to Experts tab

//--- error code constants (reduce magic numbers)
#define ERR_WEBREQUEST_NOT_ALLOWED 4014
#define ERR_WEBREQUEST_FAILED      5203

//--- track whether we've already warned about WebRequest being disabled
bool g_warnedWebRequestDisabled = false;

//+------------------------------------------------------------------+
//| Expert initialization                                            |
//+------------------------------------------------------------------+
int OnInit()
  {
   PrintFormat("[Lael] DataRelay EA initialized. Endpoint=%s Interval=%ds PreTradeCheck=%s",
               LaelEndpoint, UpdateIntervalSeconds, EnablePreTradeCheck ? "ON" : "OFF");

   EventSetTimer(UpdateIntervalSeconds);
   SendAccountUpdate();
   return INIT_SUCCEEDED;
  }

//+------------------------------------------------------------------+
//| Expert deinitialization                                          |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   EventKillTimer();
   PrintFormat("[Lael] DataRelay EA stopped (reason=%d)", reason);
  }

//+------------------------------------------------------------------+
//| Periodic account heartbeat                                       |
//+------------------------------------------------------------------+
void OnTimer()
  {
   SendAccountUpdate();
  }

//+------------------------------------------------------------------+
//| Trade transaction handler — emits trade_open / trade_close       |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction& trans,
                        const MqlTradeRequest&     request,
                        const MqlTradeResult&      result)
  {
   // Only react to actual deal additions (fills); ignore order-only events.
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD)
      return;

   if(!HistoryDealSelect(trans.deal))
      return;

   ENUM_DEAL_ENTRY entry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(trans.deal, DEAL_ENTRY);
   ENUM_DEAL_TYPE  type  = (ENUM_DEAL_TYPE)HistoryDealGetInteger(trans.deal, DEAL_TYPE);

   // Map deal entry direction to a Lael event name.
   string eventName = "";
   if(entry == DEAL_ENTRY_IN)        eventName = "trade_open";
   else if(entry == DEAL_ENTRY_OUT)  eventName = "trade_close";
   else if(entry == DEAL_ENTRY_INOUT) eventName = "trade_close";  // partial reverse counted as close
   else                              eventName = "trade_modify";

   string symbol     = HistoryDealGetString(trans.deal, DEAL_SYMBOL);
   double volume     = HistoryDealGetDouble(trans.deal, DEAL_VOLUME);
   double dealPrice  = HistoryDealGetDouble(trans.deal, DEAL_PRICE);
   double profit     = HistoryDealGetDouble(trans.deal, DEAL_PROFIT);
   ulong  positionId = HistoryDealGetInteger(trans.deal, DEAL_POSITION_ID);

   // Pull SL/TP off the live position if it still exists; closed deals have neither.
   double sl = 0.0, tp = 0.0;
   if(PositionSelectByTicket(positionId))
     {
      sl = PositionGetDouble(POSITION_SL);
      tp = PositionGetDouble(POSITION_TP);
     }

   string typeStr = (type == DEAL_TYPE_BUY) ? "buy" : (type == DEAL_TYPE_SELL ? "sell" : "other");

   string body = StringFormat(
      "{\"event\":\"%s\",\"ticket\":%I64u,\"symbol\":\"%s\",\"type\":\"%s\","
      "\"volume\":%.2f,\"openPrice\":%.5f,\"sl\":%.5f,\"tp\":%.5f,"
      "\"profit\":%.2f,\"timestamp\":%I64u}",
      eventName, positionId, symbol, typeStr,
      volume, dealPrice, sl, tp, profit, (long)TimeCurrent());

   PostJson("/api/mt5/trade", body);
  }

//+------------------------------------------------------------------+
//| Build and POST the account snapshot                              |
//+------------------------------------------------------------------+
void SendAccountUpdate()
  {
   string body = StringFormat(
      "{\"event\":\"account_update\",\"accountId\":%I64d,"
      "\"balance\":%.2f,\"equity\":%.2f,\"margin\":%.2f,"
      "\"freeMargin\":%.2f,\"marginLevel\":%.2f,\"profit\":%.2f,"
      "\"timestamp\":%I64u}",
      AccountInfoInteger(ACCOUNT_LOGIN),
      AccountInfoDouble(ACCOUNT_BALANCE),
      AccountInfoDouble(ACCOUNT_EQUITY),
      AccountInfoDouble(ACCOUNT_MARGIN),
      AccountInfoDouble(ACCOUNT_MARGIN_FREE),
      AccountInfoDouble(ACCOUNT_MARGIN_LEVEL),
      AccountInfoDouble(ACCOUNT_PROFIT),
      (long)TimeCurrent());

   PostJson("/api/mt5/account", body);
  }

//+------------------------------------------------------------------+
//| Pre-trade compliance check. Returns true if Lael allows the      |
//| trade OR if Lael is unreachable (fail-open — never block trading |
//| because the gateway is down).                                    |
//+------------------------------------------------------------------+
bool CheckCompliance(string symbol, double volume, double riskAmount)
  {
   if(!EnablePreTradeCheck)
      return true;

   string body = StringFormat(
      "{\"action\":\"check_compliance\",\"symbol\":\"%s\","
      "\"volume\":%.2f,\"riskAmount\":%.2f}",
      symbol, volume, riskAmount);

   string response = "";
   int code = PostJsonAndRead("/api/mt5/check", body, response);
   if(code < 200 || code >= 300)
     {
      PrintFormat("[Lael] Compliance check unavailable (HTTP %d) — allowing trade (fail-open)", code);
      return true;
     }

   // Tiny purpose-built parser. Looks for "allowed":true or "allowed":false.
   bool allowed = (StringFind(response, "\"allowed\":true") >= 0);
   if(!allowed)
      PrintFormat("[Lael] BLOCKED %s %.2f lots: %s", symbol, volume, response);
   return allowed;
  }

//+------------------------------------------------------------------+
//| Fire-and-forget POST. Returns true on 2xx.                       |
//+------------------------------------------------------------------+
bool PostJson(string path, string body)
  {
   string discard = "";
   int code = PostJsonAndRead(path, body, discard);
   return (code >= 200 && code < 300);
  }

//+------------------------------------------------------------------+
//| POST and capture response body.                                  |
//| Returns HTTP status code (>=200) on completion, or -1 on error.  |
//+------------------------------------------------------------------+
int PostJsonAndRead(string path, string body, string &response)
  {
   string url = LaelEndpoint + path;

   char data[];
   int dataLen = StringToCharArray(body, data, 0, -1, CP_UTF8) - 1;
   if(dataLen < 0) dataLen = 0;
   ArrayResize(data, dataLen);

   char   result[];
   string resultHeaders;
   string headers = "Content-Type: application/json\r\n";

   ResetLastError();
   int code = WebRequest("POST", url, headers, HttpTimeoutMs, data, result, resultHeaders);

   if(code == -1)
     {
      int err = GetLastError();
      if(err == ERR_WEBREQUEST_NOT_ALLOWED)
        {
         if(!g_warnedWebRequestDisabled)
           {
            PrintFormat("[Lael] WebRequest disabled or URL not whitelisted. "
                        "Open Tools -> Options -> Expert Advisors and add: %s", LaelEndpoint);
            g_warnedWebRequestDisabled = true;
           }
        }
      else if(err != ERR_WEBREQUEST_FAILED)
        {
         // 5203 (HTTP request failed) usually means Lael is offline — silent.
         PrintFormat("[Lael] POST %s failed: error %d", path, err);
        }
      return -1;
     }

   response = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   if(VerboseLogging)
      PrintFormat("[Lael] POST %s -> %d (%d bytes)", path, code, ArraySize(result));
   return code;
  }
//+------------------------------------------------------------------+

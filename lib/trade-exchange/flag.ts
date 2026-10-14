export function isTradeExchangeEnabled(env?: { TRADE_EXCHANGE_ENABLED?: string }): boolean {
  return (env?.TRADE_EXCHANGE_ENABLED ?? process.env.TRADE_EXCHANGE_ENABLED) === "1";
}

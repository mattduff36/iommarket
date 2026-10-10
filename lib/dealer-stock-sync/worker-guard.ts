import { assertDealerStockSyncEnvironment } from "../deployment/dealer-stock-sync";
export function assertWorkerEnabled(env: Record<string, string | undefined> = process.env) {
  if (env.DEALER_STOCK_SYNC_WORKER !== "1") throw new Error("Dealer stock sync worker is disabled. Set DEALER_STOCK_SYNC_WORKER=1.");
  return assertDealerStockSyncEnvironment(env);
}

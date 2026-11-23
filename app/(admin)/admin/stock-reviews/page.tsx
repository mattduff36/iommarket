export const dynamic = "force-dynamic";
export const maxDuration = 60;
import type { Metadata } from "next";
import { loadStockReviewSnapshot } from "./snapshot-loader";
import { StockReviewsClient } from "./stock-reviews-client";
import { StockWorkerPairing } from "./worker-pairing";
import { getDealerStockSyncAvailability } from "@/lib/deployment/dealer-stock-sync";
export const metadata: Metadata = { title: "Dealer scrapes | Admin" };
export default async function AdminStockReviewsPage({ searchParams }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams ?? {};
  const availability = getDealerStockSyncAvailability();
  const production = availability.environment === "production";
  const oraclePilot = availability.enabled && (production
    ? process.env.VERCEL_ENV === "production" && process.env.ORACLE_STOCK_PRODUCTION_ENABLED === "1"
    : availability.environment === "preview" && process.env.VERCEL_ENV === "preview");
  return <StockReviewsClient initial={await loadStockReviewSnapshot()} query={query} oraclePilot={oraclePilot}
    oracleEnvironment={production ? "production" : "preview"}
    pairing={typeof query.code === "string" && query.code ? <StockWorkerPairing code={query.code} status="" oracle={oraclePilot && query.pair === "oracle"} /> : null}
    offlineStatus={<StockWorkerPairing code="" status={typeof query.status === "string" ? query.status : ""} />} />;
}

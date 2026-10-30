export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { loadStockReviewSnapshot } from "./snapshot-loader";
import { StockReviewsClient } from "./stock-reviews-client";
export const metadata: Metadata = { title: "Dealer scrapes | Admin" };
export default async function AdminStockReviewsPage({ searchParams }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const query = await searchParams ?? {};
  return <StockReviewsClient initial={await loadStockReviewSnapshot()} query={query} />;
}

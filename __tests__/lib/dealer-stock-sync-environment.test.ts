import { describe, expect, it } from "vitest";
import { DEALER_SYNC_PRODUCTION_DISABLED, getDealerStockSyncAvailability } from "@/lib/deployment/dealer-stock-sync";

const previewRef = "syneonzucehwlghqmfbg";
const prodRef = "snlqivvogfqesxpbjiei";
const direct = (ref: string) => `postgresql://postgres:fixture@db.${ref}.supabase.co:5432/postgres`;
const preview = {
  NODE_ENV: "production", VERCEL_ENV: "preview", NEXT_PUBLIC_APP_URL: "https://itrader.dev",
  NEXT_PUBLIC_SUPABASE_URL: `https://${previewRef}.supabase.co`, DATABASE_URL: direct(previewRef),
};
const production = {
  ...preview, VERCEL_ENV: "production", NEXT_PUBLIC_APP_URL: "https://itrader.im",
  NEXT_PUBLIC_SUPABASE_URL: `https://${prodRef}.supabase.co`, DATABASE_URL: direct(prodRef),
};

describe("dealer stock sync environment isolation", () => {
  it("enables correctly configured preview", () => {
    expect(getDealerStockSyncAvailability(preview)).toMatchObject({ enabled: true, environment: "preview" });
  });
  it("keeps production disabled by default with the visible tooltip reason", () => {
    expect(getDealerStockSyncAvailability(production)).toMatchObject({ enabled: false, reason: DEALER_SYNC_PRODUCTION_DISABLED });
  });
  it("supports production only after explicit flag activation and correct targeting", () => {
    expect(getDealerStockSyncAvailability({ ...production, DEALER_STOCK_SYNC_PRODUCTION_ENABLED: "1" }).enabled).toBe(true);
  });
  it.each(["DATABASE_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING"])("rejects production in any preview connection: %s", (key) => {
    expect(getDealerStockSyncAvailability({ ...preview, [key]: direct(prodRef) }).enabled).toBe(false);
  });
  it("rejects preview databases in production even with the flag", () => {
    expect(getDealerStockSyncAvailability({ ...production, DEALER_STOCK_SYNC_PRODUCTION_ENABLED: "1", DATABASE_URL: direct(previewRef) }).enabled).toBe(false);
  });
  it("accepts matching pooler usernames but rejects project names hidden in passwords or queries", () => {
    expect(getDealerStockSyncAvailability({ ...preview, DATABASE_URL: `postgresql://postgres.${previewRef}:fixture@aws-0-eu-west-1.pooler.supabase.com:6543/postgres` }).enabled).toBe(true);
    expect(getDealerStockSyncAvailability({ ...preview, DATABASE_URL: `postgresql://postgres:${previewRef}@db.${prodRef}.supabase.co:5432/postgres?application_name=${previewRef}` }).enabled).toBe(false);
  });
  it("rejects mismatched app, auth and explicit worker targets", () => {
    for (const overrides of [{ NEXT_PUBLIC_APP_URL: "https://itrader.im" }, { NEXT_PUBLIC_SUPABASE_URL: `https://${prodRef}.supabase.co` }, { DEALER_STOCK_SYNC_TARGET: "production" }]) {
      expect(getDealerStockSyncAvailability({ ...preview, ...overrides }).enabled).toBe(false);
    }
  });
  it("only permits isolated loopback fixtures outside hosted production", () => {
    const local = { NODE_ENV: "test", DEALER_STOCK_SYNC_TARGET: "local", DEALER_STOCK_SYNC_ISOLATED_LOCAL: "1", DATABASE_URL: "postgresql://fixture@127.0.0.1:55439/fixture" };
    expect(getDealerStockSyncAvailability(local).enabled).toBe(true);
    expect(getDealerStockSyncAvailability({ ...local, NODE_ENV: "production" }).enabled).toBe(false);
    expect(getDealerStockSyncAvailability({ ...local, DATABASE_URL: direct(previewRef) }).enabled).toBe(false);
  });
});

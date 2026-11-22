import { describe, expect, it } from "vitest";
import { preparedStockCap } from "@/lib/dealer-stock-sync/prepared-stock-cap";

const staging = {
  NODE_ENV: "production", VERCEL_ENV: "preview", ITRADER_DEPLOYMENT_ROLE: "staging",
  NEXT_PUBLIC_APP_URL: "https://itrader.dev",
  NEXT_PUBLIC_SUPABASE_URL: "https://syneonzucehwlghqmfbg.supabase.co",
  DATABASE_URL: "postgresql://postgres:example@db.syneonzucehwlghqmfbg.supabase.co/postgres",
} as NodeJS.ProcessEnv;

describe("temporary prepared stock capacity", () => {
  it.each([
    ["van-mossel-jacksons", "cmwse345s002nfozjg6hk01vy", 138],
    ["van-mossel-motor-mall", "cmwse38zx00affozj5zoaxuo9", 112],
  ] as const)("retains the authorized stock for %s only on staging", (registryKey, dealerId, cap) => {
    const input = { tier: "PRO" as const, registryKey, dealerId };
    expect(preparedStockCap(input, staging)).toBe(cap);
    expect(preparedStockCap(input, { ...staging, VERCEL_ENV: "production" })).toBe(100);
    expect(preparedStockCap(input, { ...staging, DATABASE_URL: "postgresql://postgres:example@db.other.supabase.co/postgres" })).toBe(100);
    expect(preparedStockCap({ ...input, dealerId: "other-dealer" }, staging)).toBe(100);
    expect(preparedStockCap({ ...input, registryKey: "other" }, staging)).toBe(100);
    expect(preparedStockCap({ ...input, tier: "STARTER" }, staging)).toBe(30);
  });
});


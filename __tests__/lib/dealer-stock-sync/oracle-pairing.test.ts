import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { oracleProfiles, profileForBearer } from "@/lib/dealer-stock-sync/oracle-pairing-config";
import { oracleMessageSchema, oraclePairingStore } from "@/lib/dealer-stock-sync/oracle-pairing";

const redis = vi.hoisted(() => ({ exists: vi.fn(), get: vi.fn(), eval: vi.fn() }));
vi.mock("@upstash/redis", () => ({ Redis: class {
  exists = redis.exists;
  get = redis.get;
  eval = redis.eval;
} }));

const profile = { adminId: "cadmin0000000000000000001", token: randomBytes(32).toString("base64url") };
const second = { adminId: "cadmin0000000000000000002", token: randomBytes(32).toString("base64url") };
const project = "syneonzucehwlghqmfbg";
const env = {
  VERCEL_ENV: "preview", NEXT_PUBLIC_APP_URL: "https://itrader.dev",
  NEXT_PUBLIC_SUPABASE_URL: `https://${project}.supabase.co`,
  DATABASE_URL: `postgresql://postgres@db.${project}.supabase.co:5432/postgres`,
  DEALER_STOCK_DESKTOP_ENABLED: "1", DEALER_STOCK_DESKTOP_API_ONLY: "1",
  DEALER_STOCK_DESKTOP_ALLOWED_ADMIN_IDS: [profile, second].map(p => p.adminId).join(","),
  ORACLE_PAIRING_PROFILES: JSON.stringify([profile, second]),
  UPSTASH_REDIS_REST_URL: "https://redis.example.invalid", UPSTASH_REDIS_REST_TOKEN: "fixture",
};
const productionProject = "snlqivvogfqesxpbjiei";
const production = {
  ...env, VERCEL_ENV: "production", NEXT_PUBLIC_APP_URL: "https://itrader.im",
  NEXT_PUBLIC_SUPABASE_URL: `https://${productionProject}.supabase.co`,
  DATABASE_URL: `postgresql://postgres@db.${productionProject}.supabase.co:5432/postgres`,
  DEALER_STOCK_SYNC_PRODUCTION_ENABLED: "1", ORACLE_STOCK_PRODUCTION_ENABLED: "1",
};

afterEach(() => vi.resetAllMocks());

describe("Oracle account pairing", () => {
  it("binds independent bearer credentials to the configured allowlisted admin", () => {
    const profiles = oracleProfiles(env);
    expect(profiles).toEqual([profile, second]);
    expect(profileForBearer(profiles, `Bearer ${second.token}`)).toEqual(second);
    expect(profileForBearer(profiles, "Bearer " + randomBytes(32).toString("base64url"))).toBeUndefined();
    expect(profileForBearer(profiles, null)).toBeUndefined();
  });
  it("fails closed for environment mismatch, duplicate tokens or IDs, and unknown accounts", () => {
    expect(oracleProfiles({ ...env, VERCEL_ENV: "production" })).toEqual([]);
    expect(oracleProfiles({ ...env, NEXT_PUBLIC_APP_URL: "https://itrader.im" })).toEqual([]);
    for (const duplicate of [{ ...second, token: profile.token }, { ...second, adminId: profile.adminId }]) {
      expect(oracleProfiles({ ...env, ORACLE_PAIRING_PROFILES: JSON.stringify([profile, duplicate]) })).toEqual([]);
    }
    expect(oracleProfiles({ ...env, DEALER_STOCK_DESKTOP_ALLOWED_ADMIN_IDS: profile.adminId })).toEqual([profile]);
  });
  it("requires the canonical production host, production DB and both independent production gates", () => {
    expect(oracleProfiles(production)).toEqual([profile, second]);
    for (const override of [
      { DEALER_STOCK_SYNC_PRODUCTION_ENABLED: "0" }, { ORACLE_STOCK_PRODUCTION_ENABLED: "0" },
      { DATABASE_URL: env.DATABASE_URL }, { NEXT_PUBLIC_APP_URL: "https://itrader.dev" },
      { NEXT_PUBLIC_APP_URL: "https://www.itrader.im" }, { NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL },
    ]) expect(oracleProfiles({ ...production, ...override })).toEqual([]);
  });
  it("keeps production requests and PKCE pointers separate from Preview", async () => {
    const store = oraclePairingStore(profile, production);
    redis.eval.mockResolvedValueOnce("");
    await store.agent({ op: "poll" });
    expect(redis.eval.mock.calls[0][1][1]).toContain(":production:");
    redis.get.mockResolvedValueOnce("itrader:stock-desktop:preview:pending:fixture");
    expect(await store.agent({ op: "ready", requestId: randomUUID(), code: "ABCDEFGH" })).toEqual({ ok: false });
    expect(redis.get.mock.calls[0][0]).toContain(":production:user:");
  });
  it("rejects attempts to supply another administrator or an arbitrary pairing URL", () => {
    expect(oracleMessageSchema.safeParse({ op: "poll", adminId: second.adminId }).success).toBe(false);
    expect(oracleMessageSchema.safeParse({ op: "ready", requestId: randomUUID(), code: "https://example.test" }).success).toBe(false);
  });
  it("returns a pending request only on a poll from the matching profile", async () => {
    const requestId = randomUUID();
    redis.eval.mockResolvedValueOnce(requestId).mockResolvedValueOnce("");
    const a = oraclePairingStore(profile, env);
    const b = oraclePairingStore(second, env);
    expect(await a.agent({ op: "poll" })).toEqual({ ok: true, requestId });
    expect(await b.agent({ op: "poll" })).toEqual({ ok: true, requestId: null });
    expect(redis.eval.mock.calls[0][1][1]).not.toBe(redis.eval.mock.calls[1][1][1]);
    expect(redis.eval.mock.calls[0][1][1]).not.toContain(profile.token);
  });
  it("returns only an invitation with a live PKCE code pointer and replaces consumed codes", async () => {
    const store = oraclePairingStore(profile, env);
    redis.eval.mockResolvedValueOnce(randomUUID() + ":ABCDEFGH").mockResolvedValueOnce(randomUUID() + ":BCDEFGHJ");
    redis.exists.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    expect(await store.invitation()).toEqual({ code: "BCDEFGHJ" });
    expect(redis.eval.mock.calls[1][2][1]).toMatch(/:ABCDEFGH$/);
  });
  it("rejects malformed or missing desktop invitation pointers before publication", async () => {
    const store = oraclePairingStore(profile, env);
    redis.get.mockResolvedValueOnce("itrader:stock-desktop:production:pending:fixture");
    expect(await store.agent({ op: "ready", requestId: randomUUID(), code: "ABCDEFGH" })).toEqual({ ok: false });
    expect(redis.eval).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRateLimitExemption, isRateLimitExempt } from "@/lib/rate-limit-exemptions";

const { request, claims, currentUser } = vi.hoisted(() => ({
  request: vi.fn(),
  claims: vi.fn(),
  currentUser: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: request }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getClaims: claims } }) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: currentUser }));

const ids = ["admin-1", "admin-2", "tester-1", "tester-2", "tester-3"];
const production = {
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  VERCEL: "1",
  ITRADER_RATE_LIMIT_EXEMPT_IP: "203.0.113.8",
  ITRADER_RATE_LIMIT_EXEMPT_AUTH_IDS: ids.join(","),
};
const staging = {
  ...production,
  VERCEL_ENV: "preview",
  ITRADER_DEPLOYMENT_ROLE: "staging",
  NEXT_PUBLIC_APP_URL: "https://itrader.dev",
  NEXT_PUBLIC_SUPABASE_URL: "https://syneonzucehwlghqmfbg.supabase.co",
  DATABASE_URL: "postgresql://postgres@db.syneonzucehwlghqmfbg.supabase.co:5432/postgres",
};

describe("hosted iTrader rate-limit exemptions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    request.mockResolvedValue(new Headers({ cookie: "sb-project-auth-token.0=session" }));
  });

  it.each(ids)("accepts the exact verified production identity %s from a different IP", async id => {
    claims.mockResolvedValue({ data: { claims: { sub: id } } });
    currentUser.mockResolvedValue({ authUserId: id });
    await expect(isRateLimitExempt(production)).resolves.toBe(true);
  });

  it("uses the usual limits for an unlisted admin, an unverified session and an inactive account", async () => {
    claims.mockResolvedValueOnce({ data: { claims: { sub: "other-admin", role: "ADMIN" } } });
    await expect(isRateLimitExempt(production)).resolves.toBe(false);
    expect(currentUser).not.toHaveBeenCalled();
    claims.mockResolvedValueOnce({ error: new Error("invalid signature"), data: { claims: { sub: ids[0] } } });
    await expect(isRateLimitExempt(production)).resolves.toBe(false);
    expect(currentUser).not.toHaveBeenCalled();
    claims.mockResolvedValueOnce({ data: { claims: { sub: ids[0] } } });
    currentUser.mockResolvedValue(null);
    await expect(isRateLimitExempt(production)).resolves.toBe(false);
  });

  it.each([production, staging])("allows the exact trusted address on $VERCEL_ENV without a session", async env => {
    request.mockResolvedValue(new Headers({ "x-vercel-forwarded-for": "203.0.113.8" }));
    await expect(getRateLimitExemption(env)).resolves.toBe("ip");
    expect(claims).not.toHaveBeenCalled();
  });

  it("records the account decision even when the same request qualifies by IP", async () => {
    request.mockResolvedValue(new Headers({
      cookie: "sb-project-auth-token.0=session",
      "x-vercel-forwarded-for": "203.0.113.8",
    }));
    claims.mockResolvedValue({ data: { claims: { sub: ids[0] } } });
    currentUser.mockResolvedValue({ authUserId: ids[0] });
    await expect(getRateLimitExemption(production)).resolves.toBe("account");
  });

  it("ignores user-supplied hints, multiple addresses and other environments", async () => {
    request.mockResolvedValue(new Headers({ "x-forwarded-for": "203.0.113.8", "x-real-ip": "203.0.113.8" }));
    await expect(isRateLimitExempt(production)).resolves.toBe(false);
    request.mockResolvedValue(new Headers({ "x-vercel-forwarded-for": "203.0.113.8, 203.0.113.9" }));
    await expect(isRateLimitExempt(production)).resolves.toBe(false);
    request.mockResolvedValue(new Headers({ "x-vercel-forwarded-for": "203.0.113.8" }));
    await expect(isRateLimitExempt({ ...staging, ITRADER_DEPLOYMENT_ROLE: undefined })).resolves.toBe(false);
    await expect(isRateLimitExempt({ ...production, VERCEL: undefined })).resolves.toBe(false);
  });
});

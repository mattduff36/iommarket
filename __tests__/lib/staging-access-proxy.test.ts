import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { STAGING_ORIGIN } from "@/lib/deployment/staging-origin";
import { presentHostedCheckoutUrl } from "@/lib/payments/staging-return-routing";

const { createClientMock, getUserMock, getSessionMock, findUniqueMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  getUserMock: vi.fn(),
  getSessionMock: vi.fn(),
  findUniqueMock: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({ createServerClient: createClientMock }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: findUniqueMock } } }));

import { proxy } from "@/proxy";

const ENV_KEYS = [
  "NODE_ENV", "VERCEL_ENV", "ITRADER_DEPLOYMENT_ROLE", "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING", "DATABASE_URL", "RIPPLE_STAGING_RELAY_SECRET", "RIPPLE_CLIENT_ID",
] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

function restoreEnv() {
  vi.unstubAllEnvs();
  for (const [key, value] of originalEnv) {
    if (key === "NODE_ENV") continue;
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function configureStaging() {
  vi.stubEnv("NODE_ENV", "production");
  process.env.VERCEL_ENV = "preview";
  process.env.ITRADER_DEPLOYMENT_ROLE = "staging";
  process.env.NEXT_PUBLIC_APP_URL = "https://itrader.dev";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://syneonzucehwlghqmfbg.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.POSTGRES_URL = "postgresql://postgres@db.syneonzucehwlghqmfbg.supabase.co:5432/postgres";
  delete process.env.POSTGRES_URL_NON_POOLING;
  delete process.env.DATABASE_URL;
}

describe("staging access proxy", () => {
  beforeEach(() => {
    configureStaging();
    getUserMock.mockReset().mockResolvedValue({ data: { user: null } });
    getSessionMock.mockReset().mockResolvedValue({ data: { session: null } });
    findUniqueMock.mockReset().mockResolvedValue(null);
    createClientMock.mockReset().mockImplementation(() => ({
      auth: { getUser: getUserMock, getSession: getSessionMock },
    }));
  });

  afterEach(restoreEnv);

  it("redirects anonymous page requests to the admin sign-in and marks the response private", async () => {
    const response = await proxy(new NextRequest("https://itrader.dev/admin"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://itrader.dev/staging-access");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("denies ordinary users on API and server-action requests", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1", app_metadata: {} } } });
    findUniqueMock.mockResolvedValue({ role: "USER", disabledAt: null, deletedAt: null });

    const api = await proxy(new NextRequest("https://itrader.dev/api/me"));
    const action = await proxy(new NextRequest("https://itrader.dev/", {
      method: "POST", headers: { "next-action": "action-id" },
    }));
    expect(api.status).toBe(403);
    expect(action.status).toBe(403);
  });

  it("allows an active database administrator after Supabase validates the session", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-auth-id", app_metadata: {} } } });
    findUniqueMock.mockResolvedValue({ role: "ADMIN", disabledAt: null, deletedAt: null });

    const response = await proxy(new NextRequest("https://itrader.dev/admin"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(findUniqueMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { authUserId: "admin-auth-id" },
    }));
  });

  it.each([
    ["mattduff36@gmail.com", "DEALER"],
    ["davooomarsh@hotmail.com", "USER"],
  ])("allows the verified approved preview account %s", async (email, role) => {
    getUserMock.mockResolvedValue({ data: { user: {
      id: `auth-${email}`, email, email_confirmed_at: "2026-01-01T00:00:00Z", app_metadata: {},
    } } });
    findUniqueMock.mockResolvedValue({
      role, email: email.toUpperCase(), disabledAt: null, deletedAt: null,
    });

    const response = await proxy(new NextRequest("https://itrader.dev/account"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(findUniqueMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { authUserId: `auth-${email}` },
      select: { role: true, email: true, disabledAt: true, deletedAt: true },
    }));
  });

  it("does not allow an unverified approved address or a mismatched database email", async () => {
    getUserMock.mockResolvedValue({ data: { user: {
      id: "auth-test", email: "mattduff36@gmail.com", app_metadata: {},
    } } });
    findUniqueMock.mockResolvedValue({
      role: "USER", email: "mattduff36@gmail.com", disabledAt: null, deletedAt: null,
    });
    const unverified = await proxy(new NextRequest("https://itrader.dev/account"));
    expect(unverified.status).toBe(307);

    getUserMock.mockResolvedValue({ data: { user: {
      id: "auth-test", email: "mattduff36@gmail.com", email_confirmed_at: "2026-01-01T00:00:00Z", app_metadata: {},
    } } });
    findUniqueMock.mockResolvedValue({
      role: "USER", email: "different@example.com", disabledAt: null, deletedAt: null,
    });
    const mismatch = await proxy(new NextRequest("https://itrader.dev/account"));
    expect(mismatch.status).toBe(307);
  });

  it("fails closed on signed-machine routes when staging database configuration is invalid", async () => {
    process.env.DATABASE_URL = "postgresql://postgres@production.example:5432/postgres";
    const response = await proxy(new NextRequest("https://itrader.dev/api/webhooks/payments", {
      method: "POST",
    }));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("keeps the exact auth entry page reachable while requiring the admin gate for action POSTs", async () => {
    const page = await proxy(new NextRequest("https://itrader.dev/staging-access"));
    const action = await proxy(new NextRequest("https://itrader.dev/staging-access", {
      method: "POST", headers: { "next-action": "action-id" },
    }));
    expect(page.headers.get("x-middleware-next")).toBe("1");
    expect(action.status).toBe(401);
  });

  it.each(["/sign-in", "/forgot-password", "/auth/callback", "/staging-access"])(
    "blocks auth entry %s when the configured database is not staging",
    async (path) => {
      process.env.DATABASE_URL = "postgresql://postgres@production.example:5432/postgres";
      const response = await proxy(new NextRequest(`https://itrader.dev${path}`));
      expect(response.status).toBe(503);
      expect(createClientMock).not.toHaveBeenCalled();
    },
  );

  it("sends an anonymous root visit to the administrator gate and keeps it private", async () => {
    const response = await proxy(new NextRequest("https://itrader.dev/"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://itrader.dev/staging-access");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects an anonymous API request before any account lookup", async () => {
    const response = await proxy(new NextRequest("https://itrader.dev/api/me"));
    expect(response.status).toBe(401);
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("rejects a disabled or deleted administrator", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-auth-id", app_metadata: {} } } });
    findUniqueMock.mockResolvedValue({ role: "ADMIN", disabledAt: new Date(), deletedAt: null });
    const disabled = await proxy(new NextRequest("https://itrader.dev/api/me"));
    findUniqueMock.mockResolvedValue({ role: "ADMIN", disabledAt: null, deletedAt: new Date() });
    const deleted = await proxy(new NextRequest("https://itrader.dev/admin"));
    expect(disabled.status).toBe(403);
    expect(deleted.status).toBe(307);
    expect(deleted.headers.get("location")).toBe("https://itrader.dev/staging-access");
  });
});

describe("production checkout handoff", () => {
  const secret = "unit-test-relay-secret-32chars-minimum";
  const ripple = "https://portal.startyourripple.co.uk/card/codelabplatfdcf3a8/pay/AABBCCDDEEFF0011?reference=signed";

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.VERCEL_ENV = "production";
    delete process.env.ITRADER_DEPLOYMENT_ROLE;
    process.env.RIPPLE_STAGING_RELAY_SECRET = secret;
    process.env.RIPPLE_CLIENT_ID = "codelabplatfdcf3a8";
    process.env.NEXT_PUBLIC_APP_URL = "https://itrader.im";
  });

  afterEach(restoreEnv);

  it("sets a host-only marker and returns only provider fields to itrader.dev", async () => {
    const handoff = presentHostedCheckoutUrl(ripple, {
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_APP_URL: STAGING_ORIGIN,
      RIPPLE_STAGING_RELAY_SECRET: secret,
      RIPPLE_CLIENT_ID: "codelabplatfdcf3a8",
    });
    const armed = await proxy(new NextRequest(handoff, { headers: { host: "itrader.im" } }));
    expect(armed.status).toBe(307);
    expect(armed.headers.get("location")).toBe(ripple);
    expect(armed.headers.get("referrer-policy")).toBe("no-referrer");
    const marker = armed.cookies.get("itrader-checkout-return")?.value;
    expect(marker).toMatch(/^v1\.\d+\.[a-f0-9]{64}$/);
    expect(armed.headers.get("set-cookie")).not.toContain("Domain=.itrader.im");

    const returned = await proxy(new NextRequest("https://itrader.im/pay/success?paymentjobref=260921021772763472&redirect=https://evil.example", {
      headers: { host: "itrader.im", cookie: `itrader-checkout-return=${marker}` },
    }));
    expect(returned.status).toBe(307);
    expect(returned.headers.get("location")).toBe("https://itrader.dev/pay/success?paymentjobref=260921021772763472");
    expect(returned.headers.get("set-cookie")).toContain("Domain=.itrader.im");
    expect(returned.headers.get("set-cookie")).toContain("itrader-checkout-return=");
  });

  it("rejects a tampered handoff and ignores the old shared-domain marker", async () => {
    const invalid = await proxy(new NextRequest("https://itrader.im/pay/staging-handoff?ticket=not-a-ticket", {
      headers: { host: "itrader.im" },
    }));
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("x-robots-tag")).toBe("noindex");

    const legacy = await proxy(new NextRequest("https://itrader.im/pay/success?paymentjobref=1", {
      headers: { host: "itrader.im", cookie: "itrader-checkout-environment=preview.1790755200000" },
    }));
    expect(legacy.headers.get("location")).toBeNull();
  });
});

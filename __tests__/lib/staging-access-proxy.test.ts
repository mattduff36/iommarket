import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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
  "POSTGRES_URL_NON_POOLING", "DATABASE_URL",
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
  process.env.NEXT_PUBLIC_APP_URL = "https://staging.itrader.im";
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
    const response = await proxy(new NextRequest("https://staging.itrader.im/admin"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://staging.itrader.im/staging-access");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("denies ordinary users on API and server-action requests", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1", app_metadata: {} } } });
    findUniqueMock.mockResolvedValue({ role: "USER", disabledAt: null, deletedAt: null });

    const api = await proxy(new NextRequest("https://staging.itrader.im/api/me"));
    const action = await proxy(new NextRequest("https://staging.itrader.im/", {
      method: "POST", headers: { "next-action": "action-id" },
    }));
    expect(api.status).toBe(403);
    expect(action.status).toBe(403);
  });

  it("allows an active database administrator after Supabase validates the session", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-auth-id", app_metadata: {} } } });
    findUniqueMock.mockResolvedValue({ role: "ADMIN", disabledAt: null, deletedAt: null });

    const response = await proxy(new NextRequest("https://staging.itrader.im/admin"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(findUniqueMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { authUserId: "admin-auth-id" },
    }));
  });

  it("fails closed on signed-machine routes when staging database configuration is invalid", async () => {
    process.env.DATABASE_URL = "postgresql://postgres@production.example:5432/postgres";
    const response = await proxy(new NextRequest("https://staging.itrader.im/api/webhooks/payments", {
      method: "POST",
    }));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("keeps the exact auth entry page reachable while requiring the admin gate for action POSTs", async () => {
    const page = await proxy(new NextRequest("https://staging.itrader.im/staging-access"));
    const action = await proxy(new NextRequest("https://staging.itrader.im/staging-access", {
      method: "POST", headers: { "next-action": "action-id" },
    }));
    expect(page.headers.get("x-middleware-next")).toBe("1");
    expect(action.status).toBe(401);
  });

  it.each(["/sign-in", "/forgot-password", "/auth/callback", "/staging-access"])(
    "blocks auth entry %s when the configured database is not staging",
    async (path) => {
      process.env.DATABASE_URL = "postgresql://postgres@production.example:5432/postgres";
      const response = await proxy(new NextRequest(`https://staging.itrader.im${path}`));
      expect(response.status).toBe(503);
      expect(createClientMock).not.toHaveBeenCalled();
    },
  );
});

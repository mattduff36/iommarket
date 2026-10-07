import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthUser, findUniqueMock } = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  findUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { user: { findUnique: findUniqueMock } } }));
vi.mock("@/lib/auth/supabase-config", () => ({ isSupabaseAuthConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: getAuthUser } })),
}));
vi.mock("@/lib/dealers/onboarding/access-gate", () => ({
  findBlockingOnboardingInvite: vi.fn(async () => null),
  OnboardingIncompleteError: class OnboardingIncompleteError extends Error {},
}));
vi.mock("@/lib/dealers/onboarding/session-cutoff", () => ({
  isOnboardingSessionStale: () => false,
  readOnboardingSessionInvalidBefore: () => null,
}));

import { InsufficientPermissionsError, requireAuth } from "@/lib/auth";

const ENV_KEYS = [
  "NODE_ENV", "VERCEL_ENV", "ITRADER_DEPLOYMENT_ROLE", "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "DATABASE_URL",
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
  process.env.POSTGRES_URL = "postgresql://postgres@db.syneonzucehwlghqmfbg.supabase.co:5432/postgres";
  delete process.env.POSTGRES_URL_NON_POOLING;
  delete process.env.DATABASE_URL;
}

describe("requireAuth staging test-account access", () => {
  beforeEach(() => {
    configureStaging();
    getAuthUser.mockReset();
    findUniqueMock.mockReset();
  });

  afterEach(restoreEnv);

  it.each([
    ["mattduff36@gmail.com", "DEALER"],
    ["davooomarsh@hotmail.com", "USER"],
  ])("admits the active verified account %s through the server auth guard", async (email, role) => {
    getAuthUser.mockResolvedValue({ data: { user: {
      id: `auth-${email}`, email, email_confirmed_at: "2026-01-01T00:00:00Z", app_metadata: {},
    } } });
    findUniqueMock.mockResolvedValue({
      id: `db-${email}`, authUserId: `auth-${email}`, email: email.toUpperCase(), role,
      disabledAt: null, deletedAt: null, dealerProfile: null,
    });

    const user = await requireAuth();
    expect(user.id).toBe(`db-${email}`);
    expect(user.stagingAccessAllowed).toBe(true);
  });

  it("rejects an approved address until Supabase confirms its email", async () => {
    getAuthUser.mockResolvedValue({ data: { user: {
      id: "auth-user", email: "mattduff36@gmail.com", app_metadata: {},
    } } });
    findUniqueMock.mockResolvedValue({
      id: "db-user", authUserId: "auth-user", email: "mattduff36@gmail.com", role: "USER",
      disabledAt: null, deletedAt: null, dealerProfile: null,
    });

    await expect(requireAuth()).rejects.toBeInstanceOf(InsufficientPermissionsError);
  });

  it("keeps ordinary accounts outside the approved preview list denied", async () => {
    getAuthUser.mockResolvedValue({ data: { user: {
      id: "auth-user", email: "ordinary@example.com", email_confirmed_at: "2026-01-01T00:00:00Z", app_metadata: {},
    } } });
    findUniqueMock.mockResolvedValue({
      id: "db-user", authUserId: "auth-user", email: "ordinary@example.com", role: "USER",
      disabledAt: null, deletedAt: null, dealerProfile: null,
    });

    await expect(requireAuth()).rejects.toBeInstanceOf(InsufficientPermissionsError);
  });
});

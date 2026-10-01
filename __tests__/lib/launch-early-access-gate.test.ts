import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const hasConfirmedSupabaseSession = vi.hoisted(() => vi.fn());

vi.mock("@/lib/launch/supabase-unlock", () => ({
  hasSupabaseAuthCookie: (request: NextRequest) =>
    request.cookies.getAll().some((cookie) => cookie.name.includes("auth-token")),
  hasConfirmedSupabaseSession,
}));

const ORIGINAL_ENV = {
  VERCEL_ENV: process.env.VERCEL_ENV,
  PRODUCTION_LAUNCH_ENABLED: process.env.PRODUCTION_LAUNCH_ENABLED,
  PREVIEW_LAUNCH_GATE_QA: process.env.PREVIEW_LAUNCH_GATE_QA,
  DEV_GATE_SECRET: process.env.DEV_GATE_SECRET,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("early-access launch gate", () => {
  afterEach(() => {
    restoreEnv();
    hasConfirmedSupabaseSession.mockReset();
  });

  it("keeps Preview open unless the QA flag is exactly 1", async () => {
    process.env.VERCEL_ENV = "preview";
    delete process.env.PREVIEW_LAUNCH_GATE_QA;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const { proxy } = await import("@/proxy");
    const open = await proxy(new NextRequest("https://preview.itrader.im/"));
    expect(open.headers.get("x-middleware-rewrite")).toBeNull();

    process.env.PREVIEW_LAUNCH_GATE_QA = "1";
    const gated = await proxy(new NextRequest("https://preview.itrader.im/"));
    expect(gated.headers.get("x-middleware-rewrite")).toContain("/holding");
  });

  it("allows sign-in and blocks catalogue APIs until a confirmed session is present", async () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.PRODUCTION_LAUNCH_ENABLED;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const { proxy } = await import("@/proxy");

    const signIn = await proxy(new NextRequest("https://itrader.im/sign-in"));
    expect(signIn.headers.get("location")).toBeNull();
    const search = await proxy(new NextRequest("https://itrader.im/api/search"));
    expect(search.status).toBe(503);

    hasConfirmedSupabaseSession.mockResolvedValue(true);
    const unlocked = await proxy(
      new NextRequest("https://itrader.im/api/search", {
        headers: { cookie: "sb-preview-auth-token=session" },
      }),
    );
    expect(unlocked.status).toBe(200);
    expect(hasConfirmedSupabaseSession).toHaveBeenCalledTimes(1);
  });
});

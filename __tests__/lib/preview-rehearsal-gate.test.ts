import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { shouldEnforceLaunchGate } from "@/lib/launch/gate";
import { PUBLIC_LAUNCH_AT } from "@/lib/launch/preview-rehearsal";

const hasConfirmedSupabaseSession = vi.hoisted(() => vi.fn());

vi.mock("@/lib/launch/supabase-unlock", () => ({
  hasSupabaseAuthCookie: () => false,
  hasConfirmedSupabaseSession,
}));

const ORIGINAL_ENV = {
  VERCEL_ENV: process.env.VERCEL_ENV,
  VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
  PRODUCTION_LAUNCH_ENABLED: process.env.PRODUCTION_LAUNCH_ENABLED,
  PREVIEW_LAUNCH_GATE_QA: process.env.PREVIEW_LAUNCH_GATE_QA,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const previewBranch = {
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "preview",
} as const;

describe("public launch gate", () => {
  afterEach(() => {
    restoreEnv();
    hasConfirmedSupabaseSession.mockReset();
    vi.useRealTimers();
  });

  it("leaves preview open, including the preview branch", () => {
    expect(shouldEnforceLaunchGate(previewBranch, PUBLIC_LAUNCH_AT - 1)).toBe(false);
    expect(
      shouldEnforceLaunchGate(
        { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feature/other" },
        PUBLIC_LAUNCH_AT - 1,
      ),
    ).toBe(false);
    expect(
      shouldEnforceLaunchGate(
        { ...previewBranch, PREVIEW_LAUNCH_GATE_QA: "1" },
        PUBLIC_LAUNCH_AT,
      ),
    ).toBe(true);
  });

  it("keeps production closed until 10:00 BST and then opens it", () => {
    expect(shouldEnforceLaunchGate({ VERCEL_ENV: "production" }, PUBLIC_LAUNCH_AT - 1)).toBe(true);
    expect(shouldEnforceLaunchGate({ VERCEL_ENV: "production" }, PUBLIC_LAUNCH_AT)).toBe(false);
    expect(
      shouldEnforceLaunchGate(
        { VERCEL_ENV: "production", PRODUCTION_LAUNCH_ENABLED: "1" },
        PUBLIC_LAUNCH_AT - 1,
      ),
    ).toBe(false);
  });

  it("serves the holding page on production until 10:00 and leaves preview open", async () => {
    vi.useFakeTimers();
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_GIT_COMMIT_REF = "preview";
    delete process.env.PREVIEW_LAUNCH_GATE_QA;
    delete process.env.PRODUCTION_LAUNCH_ENABLED;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const { proxy } = await import("@/proxy");

    vi.setSystemTime(PUBLIC_LAUNCH_AT - 1);
    const preview = await proxy(new NextRequest("https://preview.itrader.im/"));
    expect(preview.headers.get("x-middleware-rewrite")).toBeNull();

    process.env.VERCEL_ENV = "production";
    delete process.env.VERCEL_GIT_COMMIT_REF;
    const closed = await proxy(new NextRequest("https://itrader.im/"));
    expect(closed.headers.get("x-middleware-rewrite")).toContain("/holding");
    expect(closed.headers.get("cache-control")).toBe("no-store");

    const redirected = await proxy(new NextRequest("https://itrader.im/search"));
    expect(redirected.headers.get("location")).toBe("https://itrader.im/");
    expect(redirected.headers.get("cache-control")).toBe("no-store");

    vi.setSystemTime(PUBLIC_LAUNCH_AT);
    const open = await proxy(new NextRequest("https://itrader.im/"));
    expect(open.headers.get("x-middleware-rewrite")).toBeNull();
  });
});

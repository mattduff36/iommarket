import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { isPaymentReturnPath } from "@/lib/payments/return-routes";

describe("public provider return pages", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(["success", "failed", "cancelled"])("allows %s without a login or launch cookie", async (outcome) => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("PRODUCTION_LAUNCH_ENABLED", "false");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://must-not-be-contacted.invalid");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-key");
    const response = await proxy(new NextRequest(`https://itrader.im/pay/${outcome}?status=success&paymentref=untrusted&returnTo=https://example.com`));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it.each(["/pay", "/pay/success/extra", "/pay/success-evil", "/account/listings", "/api/payments"])("does not expose %s", async (path) => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("PRODUCTION_LAUNCH_ENABLED", "false");
    expect(isPaymentReturnPath(path)).toBe(false);
    const response = await proxy(new NextRequest(`https://itrader.im${path}`));
    expect(response.headers.get("x-middleware-next")).toBeNull();
  });
});

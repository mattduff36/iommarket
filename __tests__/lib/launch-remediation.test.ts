import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { classifyLaunchRoute } from "@/lib/launch/route-class";
import { buildLaunchRobots, buildLaunchSitemap } from "@/lib/launch/public-metadata";
import {
  issueLaunchGateCookie,
  launchGateSecretBytes,
  LAUNCH_GATE_COOKIE,
  verifyLaunchGateCookie,
} from "@/lib/launch/session";
import { classifyCostSyncFailure } from "@/lib/costs/sync";
import { CostProviderUnavailableError } from "@/lib/costs/vercel";
import { acceptedAuthHttpStatus } from "@/lib/policy/gate";
import { InsufficientPermissionsError } from "@/lib/auth";
import { classifyLaunchEnvironment } from "@/lib/ops/production-env-contract";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";

const SECRET = "0123456789abcdef0123456789abcdef";
const NOW = Date.parse("2026-09-22T09:00:00.000Z");
const ORIGINAL_ENV = {
  VERCEL_ENV: process.env.VERCEL_ENV,
  PRODUCTION_LAUNCH_ENABLED: process.env.PRODUCTION_LAUNCH_ENABLED,
  DEV_GATE_SECRET: process.env.DEV_GATE_SECRET,
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function gateProduction() {
  process.env.VERCEL_ENV = "production";
  delete process.env.PRODUCTION_LAUNCH_ENABLED;
  process.env.DEV_GATE_SECRET = SECRET;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

describe("launch gate", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("classifies exact route boundaries", () => {
    expect(classifyLaunchRoute("/api/search")).toBe("gated-api");
    expect(classifyLaunchRoute("/api/search/extra")).toBe("gated-api");
    expect(classifyLaunchRoute("/api/cron")).toBe("trusted-hook");
    expect(classifyLaunchRoute("/api/cron/listing-expiry")).toBe("trusted-hook");
    expect(classifyLaunchRoute("/api/cron-evil")).toBe("gated-api");
    expect(classifyLaunchRoute("/api/webhooks/payments")).toBe("trusted-hook");
    expect(classifyLaunchRoute("/api/webhooks/payments-evil")).toBe("gated-api");
    expect(classifyLaunchRoute("/api/internal/cost-sync")).toBe("trusted-hook");
    expect(classifyLaunchRoute("/api/monitoring/events")).toBe("trusted-hook");
    expect(classifyLaunchRoute("/api/vehicle-check")).toBe("public-api");
    expect(classifyLaunchRoute("/robots.txt")).toBe("seo");
    expect(classifyLaunchRoute("/sitemap.xml")).toBe("seo");
    expect(classifyLaunchRoute("/dealer/onboarding/claim")).toBe("legal");
  });

  it("rejects legacy, tampered, expired, and wrong-environment cookies", () => {
    expect(launchGateSecretBytes("short")).toBeNull();
    const issued = issueLaunchGateCookie({
      secret: SECRET,
      environment: "production",
      now: NOW,
      nonce: "abcd",
    });
    expect(issued?.options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
    expect(issued?.options).not.toHaveProperty("domain");
    expect(
      verifyLaunchGateCookie(issued?.value, {
        secret: SECRET,
        environment: "production",
        now: NOW,
      }),
    ).toBe(true);
    expect(
      verifyLaunchGateCookie("true", {
        secret: SECRET,
        environment: "production",
        now: NOW,
      }),
    ).toBe(false);
    expect(
      verifyLaunchGateCookie(issued?.value, {
        secret: SECRET,
        environment: "preview",
        now: NOW,
      }),
    ).toBe(false);
    expect(
      verifyLaunchGateCookie(`${issued?.value}ff`, {
        secret: SECRET,
        environment: "production",
        now: NOW,
      }),
    ).toBe(false);
    expect(
      verifyLaunchGateCookie(issued?.value, {
        secret: SECRET,
        environment: "production",
        now: NOW + 13 * 60 * 60 * 1000,
      }),
    ).toBe(false);
  });

  it("returns JSON 503 for gated catalogue APIs and leaves trusted hooks reachable", async () => {
    gateProduction();
    const search = await proxy(new NextRequest("https://itrader.im/api/search"));
    expect(search.status).toBe(503);
    await expect(search.json()).resolves.toEqual({ error: "Service unavailable" });

    const legacy = new NextRequest("https://itrader.im/api/search", {
      headers: { cookie: "dev-auth=true" },
    });
    expect((await proxy(legacy)).status).toBe(503);

    const cron = await proxy(new NextRequest("https://itrader.im/api/cron/cost-maintenance"));
    expect(cron.status).toBe(200);
    expect(cron.headers.get("location")).toBeNull();

    const issued = issueLaunchGateCookie({
      secret: SECRET,
      environment: "production",
      now: Date.now(),
    });
    const unlocked = await proxy(
      new NextRequest("https://itrader.im/api/search", {
        headers: { cookie: `${LAUNCH_GATE_COOKIE}=${issued?.value}` },
      }),
    );
    expect(unlocked.status).toBe(200);
  });

  it("keeps robots and sitemap readable without a database read while gated", async () => {
    const gated = { VERCEL_ENV: "production" };
    expect(buildLaunchRobots(gated).rules).toEqual({ userAgent: "*", disallow: "/" });
    expect(buildLaunchRobots(gated).sitemap).toBeUndefined();
    let loaded = false;
    await expect(
      buildLaunchSitemap(gated, async () => {
        loaded = true;
        return [{ url: "https://itrader.im/listings/1" }];
      }),
    ).resolves.toEqual([]);
    expect(loaded).toBe(false);

    const live = { VERCEL_ENV: "production", PRODUCTION_LAUNCH_ENABLED: "1" };
    expect(buildLaunchRobots(live).sitemap).toContain("/sitemap.xml");
    await expect(
      buildLaunchSitemap(live, async () => [{ url: "https://itrader.im/" }]),
    ).resolves.toEqual([{ url: "https://itrader.im/" }]);

    const robots = await proxy(new NextRequest("https://itrader.im/robots.txt"));
    const sitemap = await proxy(new NextRequest("https://itrader.im/sitemap.xml"));
    expect(robots.status).toBe(200);
    expect(sitemap.status).toBe(200);
    expect(readFileSync(resolve(process.cwd(), "app/sitemap.ts"), "utf8")).not.toContain(
      "expireStaleLiveListings",
    );
    const layout = readFileSync(resolve(process.cwd(), "app/layout.tsx"), "utf8");
    expect(layout).not.toContain("maximumScale");
    expect(layout).not.toContain("userScalable");
    expect(readFileSync(resolve(process.cwd(), "app/(public)/page.tsx"), "utf8")).toContain(
      'canonical: buildCanonicalUrl("/")',
    );
    expect(readFileSync(resolve(process.cwd(), "app/(public)/demo/payments/page.tsx"), "utf8")).toContain(
      'process.env.VERCEL_ENV === "production"',
    );
  });

  it("maps only known permission failures to 403", () => {
    expect(acceptedAuthHttpStatus(new InsufficientPermissionsError())).toBe(403);
    expect(acceptedAuthHttpStatus(new Error("database unavailable"))).toBe(500);
  });

  it("classifies cost sync failures without treating them as success", () => {
    expect(classifyCostSyncFailure(new CostProviderUnavailableError("billing down"))).toBe(
      "VERCEL_BILLING_UNAVAILABLE",
    );
    expect(classifyCostSyncFailure(new Error("FOCUS request timeout"))).toBe("COST_SYNC_TIMEOUT");
    expect(classifyCostSyncFailure("nope")).toBe("COST_SYNC_FAILED");
    const route = readFileSync(resolve(process.cwd(), "app/api/cron/cost-maintenance/route.ts"), "utf8");
    expect(route).toContain('if (status === "failed") return 502;');
  });

  it("classifies launch configuration without returning secret values", () => {
    const clientId = "clientexample123";
    const result = classifyLaunchEnvironment({
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      PRODUCTION_LAUNCH_ENABLED: "1",
      DEV_GATE_SECRET: SECRET,
      UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: SECRET,
      CLOUDINARY_API_KEY: "cloud-key",
      CLOUDINARY_API_SECRET: SECRET,
      NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: "du3othqre",
      RIPPLE_LIVE_CHECKOUT_ENABLED: "1",
      RIPPLE_CLIENT_ID: clientId,
      RIPPLE_WEBHOOK_SECRET: SECRET,
      RIPPLE_REFERENCE_SECRET: SECRET,
      SUPABASE_DB_CA_CERT: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
      RIPPLE_LISTING_PAYMENT_URL: `https://portal.startyourripple.co.uk/card/${clientId}/pay/${RIPPLE_CANONICAL_PRODUCTS.listing.code}`,
      RIPPLE_FEATURED_PAYMENT_URL: `https://portal.startyourripple.co.uk/card/${clientId}/pay/${RIPPLE_CANONICAL_PRODUCTS.featured.code}`,
      RIPPLE_DEALER_STARTER_URL: `https://portal.startyourripple.co.uk/card/${clientId}/pay/${RIPPLE_CANONICAL_PRODUCTS.starter.code}`,
      RIPPLE_DEALER_PRO_URL: `https://portal.startyourripple.co.uk/card/${clientId}/pay/${RIPPLE_CANONICAL_PRODUCTS.pro.code}`,
      STRIPE_SECRET_KEY: "unused-provider-value",
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
    });
    expect(result.launchState).toBe("production-live");
    expect(result.issues.map((issue) => `${issue.code}:${issue.key}`)).toEqual([
      "forbidden:NODE_TLS_REJECT_UNAUTHORIZED",
      "legacy-stripe:STRIPE_SECRET_KEY",
    ]);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain("unused-provider-value");
  });
});

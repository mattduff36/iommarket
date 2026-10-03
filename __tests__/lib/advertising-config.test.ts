import { describe, expect, it } from "vitest";
import {
  advertisingDiagnostics,
  publicAdvertisingConfig,
  resolveAdvertisingDestination,
} from "@/lib/advertising/config";
import { deliverAdvertisingEvents, resetAdvertisingDeliveryForTests } from "@/lib/advertising/deliver";
import { claimPurchaseDelivery } from "@/lib/advertising/purchase-claim";
import {
  buildServicePurchaseEvent,
  selectServicePurchaseSource,
} from "@/lib/advertising/outcomes";
import { applyCampaignTouch, readCampaignParams, summariseOutcomeCoverage } from "@/lib/advertising/attribution";

const liveToken = "live-token-value";
const testToken = "test-token-value";

describe("advertising destination isolation", () => {
  it("refuses live delivery outside production and refuses shared datasets", () => {
    const preview = resolveAdvertisingDestination({
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
      ADVERTISING_DELIVERY: "live",
      META_DATASET_ID: "1234567890",
      META_CAPI_ACCESS_TOKEN: liveToken,
    });
    expect(preview.mode).toBe("off");
    expect(preview.reason).toMatch(/live delivery/i);

    const shared = resolveAdvertisingDestination({
      VERCEL_ENV: "production",
      NODE_ENV: "production",
      ADVERTISING_DELIVERY: "test",
      META_DATASET_ID: "1234567890",
      META_TEST_DATASET_ID: "1234567890",
      META_TEST_CAPI_ACCESS_TOKEN: testToken,
    });
    expect(shared.mode).toBe("off");
  });

  it("uses only the test destination and omits secrets from public config", () => {
    const env = {
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
      ADVERTISING_DELIVERY: "test",
      META_DATASET_ID: "1111111111",
      META_CAPI_ACCESS_TOKEN: liveToken,
      META_TEST_DATASET_ID: "2222222222",
      META_TEST_CAPI_ACCESS_TOKEN: testToken,
    };
    const destination = resolveAdvertisingDestination(env);
    expect(destination.mode).toBe("test");
    expect(destination.meta?.datasetId).toBe("2222222222");
    const published = JSON.stringify(publicAdvertisingConfig(env));
    expect(published).toContain("2222222222");
    expect(published).not.toContain(testToken);
    expect(published).not.toContain(liveToken);
    expect(advertisingDiagnostics(env).tokenPresent).toBe(true);
    expect(JSON.stringify(advertisingDiagnostics(env))).not.toContain(testToken);
  });

  it("stays disabled when test mode would otherwise fall back to live credentials", () => {
    expect(resolveAdvertisingDestination({
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
      ADVERTISING_DELIVERY: "test",
      META_DATASET_ID: "1111111111",
      META_CAPI_ACCESS_TOKEN: liveToken,
    }).mode).toBe("off");
    expect(resolveAdvertisingDestination({
      NODE_ENV: "production",
      ADVERTISING_DELIVERY: "live",
      META_DATASET_ID: "1111111111",
      META_CAPI_ACCESS_TOKEN: liveToken,
    }).mode).toBe("off");
  });

  it("blocks live activation and does not claim Google Ads conversion delivery", () => {
    const live = resolveAdvertisingDestination({
      VERCEL_ENV: "production",
      NODE_ENV: "production",
      ADVERTISING_DELIVERY: "live",
      META_DATASET_ID: "1111111111",
      META_CAPI_ACCESS_TOKEN: liveToken,
    });
    expect(live.mode).toBe("off");
    expect(live.reason).toMatch(/durable consent/i);
    const googleOnly = resolveAdvertisingDestination({
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
      ADVERTISING_DELIVERY: "test",
      GOOGLE_ADS_TEST_ID: "AW-123456789",
      GOOGLE_ADS_TEST_CONVERSION_LABEL: "Label123",
    });
    expect(googleOnly.mode).toBe("off");
    expect(googleOnly.reason).toMatch(/not implemented/i);
  });
});

describe("advertising events", () => {
  it("builds a purchase from the service amount and ignores a free or ambiguous charge", () => {
    expect(buildServicePurchaseEvent({
      transactionId: "payment_1",
      amountPence: 499,
      currency: "gbp",
    })).toMatchObject({ eventName: "Purchase", value: 4.99, currency: "GBP", eventId: "purchase:payment_1" });
    expect(buildServicePurchaseEvent({ transactionId: "payment_1", amountPence: 0, currency: "gbp" })).toBeNull();
    expect(selectServicePurchaseSource({
      payment: { id: "pay", amount: 499, currency: "gbp", status: "SUCCEEDED" },
      charge: { id: "charge", amount: 2999, currency: "gbp" },
    })).toBeNull();
    expect(selectServicePurchaseSource({
      payment: { id: "pay", amount: 1500000, currency: "gbp", status: "SUCCEEDED" },
      charge: null,
    })?.amountPence).toBe(1500000);
  });

  it("does not send a duplicate event and does not throw when the provider fails", async () => {
    resetAdvertisingDeliveryForTests();
    const env = {
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
      ADVERTISING_DELIVERY: "test",
      META_TEST_DATASET_ID: "2222222222",
      META_TEST_CAPI_ACCESS_TOKEN: testToken,
    };
    const event = {
      eventName: "ViewContent" as const,
      eventId: "ViewContent:listing1",
      contentId: "listing1",
    };
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response("no", { status: 500 });
    };
    const failed = await deliverAdvertisingEvents([event], { env, fetchImpl, sleep: async () => undefined });
    expect(failed.delivered).toBe(false);
    expect(failed.reason).toBe("provider_error");
    expect(calls).toBe(2);
    const retried = await deliverAdvertisingEvents([event], {
      env,
      fetchImpl: async () => new Response("ok", { status: 200 }),
      sleep: async () => undefined,
    });
    expect(retried.delivered).toBe(true);
    const duplicate = await deliverAdvertisingEvents([event], {
      env,
      fetchImpl: async () => new Response("ok", { status: 200 }),
      sleep: async () => undefined,
    });
    expect(duplicate.reason).toBe("duplicate");
  });

  it("uses a separate purchase claim when Redis is absent", async () => {
    resetAdvertisingDeliveryForTests();
    expect(await claimPurchaseDelivery("payment_2", { env: {} })).toBe(true);
    let calls = 0;
    const result = await deliverAdvertisingEvents([
      buildServicePurchaseEvent({ transactionId: "payment_2", amountPence: 499, currency: "gbp" })!,
    ], {
      env: {
        VERCEL_ENV: "preview",
        NODE_ENV: "production",
        ADVERTISING_DELIVERY: "test",
        GA4_TEST_MEASUREMENT_ID: "G-TEST1234",
        GA4_TEST_API_SECRET: "ga4-test-secret",
      },
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, { status: 204 });
      },
    });
    expect(result.delivered).toBe(true);
    expect(calls).toBe(1);
  });

  it("retries only the failed provider after partial delivery", async () => {
    resetAdvertisingDeliveryForTests();
    const env = {
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
      ADVERTISING_DELIVERY: "test",
      META_TEST_DATASET_ID: "2222222222",
      META_TEST_CAPI_ACCESS_TOKEN: testToken,
      GA4_TEST_MEASUREMENT_ID: "G-TEST1234",
      GA4_TEST_API_SECRET: "ga4-test-secret",
    };
    const event = { eventName: "ViewContent" as const, eventId: "view-unique-event-1" };
    const calls: string[] = [];
    const first = await deliverAdvertisingEvents([event], {
      env,
      fetchImpl: async (url) => {
        calls.push(String(url));
        return String(url).includes("facebook.com")
          ? new Response("ok", { status: 200 })
          : new Response("error", { status: 500 });
      },
      sleep: async () => undefined,
    });
    expect(first.reason).toBe("provider_error");
    const retried = await deliverAdvertisingEvents([event], {
      env,
      fetchImpl: async (url) => {
        calls.push(String(url));
        return new Response(null, { status: 204 });
      },
      sleep: async () => undefined,
    });
    expect(retried.delivered).toBe(true);
    expect(calls.filter((url) => url.includes("facebook.com"))).toHaveLength(1);
    expect(calls.filter((url) => url.includes("google-analytics.com"))).toHaveLength(3);
  });

  it("claims a purchase once and sends GA4 a transaction id", async () => {
    const fetchImpl = async () => Response.json({ result: "OK" });
    const again = async () => Response.json({ result: null });
    await expect(claimPurchaseDelivery("payment_1", {
      env: { UPSTASH_REDIS_REST_URL: "https://example.upstash.io", UPSTASH_REDIS_REST_TOKEN: "token-value" },
      fetchImpl,
    })).resolves.toBe(true);
    await expect(claimPurchaseDelivery("payment_1", {
      env: { UPSTASH_REDIS_REST_URL: "https://example.upstash.io", UPSTASH_REDIS_REST_TOKEN: "token-value" },
      fetchImpl: again,
    })).resolves.toBe(false);

    resetAdvertisingDeliveryForTests();
    let body = "";
    await deliverAdvertisingEvents([
      buildServicePurchaseEvent({ transactionId: "payment_1", amountPence: 499, currency: "gbp" })!,
    ], {
      env: {
        VERCEL_ENV: "preview",
        NODE_ENV: "production",
        ADVERTISING_DELIVERY: "test",
        GA4_TEST_MEASUREMENT_ID: "G-TEST1234",
        GA4_TEST_API_SECRET: "ga4-test-secret",
      },
      fetchImpl: async (_url, init) => {
        body = String(init?.body ?? "");
        return new Response(null, { status: 204 });
      },
      sleep: async () => undefined,
    });
    expect(body).toContain("\"name\":\"purchase\"");
    expect(body).toContain("\"transaction_id\":\"payment_1\"");
    expect(body).not.toContain("15000");
  });
});

describe("campaign attribution", () => {
  it("keeps an allowlist, first and last touch, and treats missing totals as unknown", () => {
    const incoming = readCampaignParams("?utm_source=meta&utm_campaign=spring&email=person@example.com&fbclid=IwAR123");
    expect(incoming).toEqual({ utm_source: "meta", utm_campaign: "spring", fbclid: "IwAR123" });
    expect(readCampaignParams("?q=registration%20mark")).toBeNull();
    const first = applyCampaignTouch(null, incoming, new Date("2026-10-03T10:00:00Z"));
    const direct = applyCampaignTouch(first, null, new Date("2026-10-04T10:00:00Z"));
    expect(direct?.first.params.utm_source).toBe("meta");
    expect(direct?.last.params.utm_campaign).toBe("spring");
    const next = applyCampaignTouch(direct, { utm_source: "google" }, new Date("2026-10-05T10:00:00Z"));
    expect(next?.first.params.utm_source).toBe("meta");
    expect(next?.last.params.utm_source).toBe("google");
    expect(summariseOutcomeCoverage({ measuredTotal: null, consentedAttributed: 0 }).unknown).toBeNull();
    expect(summariseOutcomeCoverage({ measuredTotal: 4, consentedAttributed: 1 }).unknown).toBe(3);
  });
});

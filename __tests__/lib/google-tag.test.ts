import { afterEach, describe, expect, it, vi } from "vitest";
import { googleTagConfig } from "@/lib/analytics/google-tag";
import {
  isAnalyticsPathAllowed,
  safeAnalyticsPageView,
} from "@/lib/analytics/privacy";
import {
  ensureGoogleTag,
  sendMarketplaceAnalyticsEvent,
} from "@/lib/analytics/google-tag-client";

describe("Google Analytics deployment config", () => {
  it("only enables a valid measurement id in production", () => {
    expect(googleTagConfig({ VERCEL_ENV: "production", GA4_MEASUREMENT_ID: " G-6PD78XKCZ6 " })).toEqual({
      enabled: true,
      measurementId: "G-6PD78XKCZ6",
    });
    expect(googleTagConfig({ VERCEL_ENV: "preview", GA4_MEASUREMENT_ID: "G-6PD78XKCZ6" })).toEqual({
      enabled: false,
      measurementId: null,
    });
    expect(googleTagConfig({ VERCEL_ENV: "production", GA4_MEASUREMENT_ID: "not-an-id" })).toEqual({
      enabled: false,
      measurementId: null,
    });
  });
});

describe("Google Analytics privacy filtering", () => {
  it.each([
    "/admin",
    "/admin/analytics",
    "/account",
    "/auth/callback",
    "/dealer/dashboard",
    "/dealer/profile",
    "/dealer/correspondence/verify",
    "/verify/email",
    "/sell/create/listing",
    "/sell/checkout",
  ]) (
    "blocks private path %s",
    (path) => expect(isAnalyticsPathAllowed(path)).toBe(false),
  );

  it("allows public paths but removes query strings and fragments from location and referrer", () => {
    expect(safeAnalyticsPageView({
      protocol: "http:",
      hostname: "WWW.ITRADER.IM",
      pathname: "/listings/vehicle-123?email=private@example.com#contact",
      referrer: "https://search.example/find?token=private#results",
    })).toEqual({
      page_location: "https://www.itrader.im/listings/vehicle-123",
      page_referrer: "https://search.example/find",
      page_title: "iTrader | Isle of Man Vehicle Sales",
    });
  });

  it("omits sensitive referrer paths and rejects non-production hosts", () => {
    expect(safeAnalyticsPageView({
      protocol: "https:",
      hostname: "itrader.im",
      pathname: "/",
      referrer: "https://itrader.im/account/reset?token=secret",
    })).toEqual({
      page_location: "https://itrader.im/",
      page_referrer: "",
      page_title: "iTrader | Isle of Man Vehicle Sales",
    });
    expect(safeAnalyticsPageView({
      protocol: "https:",
      hostname: "itrader.im",
      pathname: "/",
      referrer: "not a valid URL",
    })?.page_referrer).toBe("");
    expect(safeAnalyticsPageView({
      protocol: "https:",
      hostname: "itrader-git-feature.vercel.app",
      pathname: "/",
    })).toBeNull();
    expect(safeAnalyticsPageView({
      protocol: "https:",
      hostname: "itrader.dev",
      pathname: "/",
    })).toBeNull();
  });
});

describe("Google tag queue", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("queues canonical Arguments commands and restricts events to the measurement ID", () => {
    const fakeWindow: { dataLayer: IArguments[]; gtag?: (...args: unknown[]) => void } = {
      dataLayer: [],
    };
    vi.stubGlobal("window", fakeWindow);
    const gtag = ensureGoogleTag();
    gtag("config", "G-6PD78XKCZ6", { send_page_view: false });
    sendMarketplaceAnalyticsEvent("G-6PD78XKCZ6", "search_performed", {
      category: "Cars",
      email: "private@example.com",
      query: "private search",
      page_location: "https://itrader.im/account?token=secret",
    }, {
      page_location: "https://itrader.im/",
      page_referrer: "",
      page_title: "iTrader | Isle of Man Vehicle Sales",
    });

    expect(Object.prototype.toString.call(fakeWindow.dataLayer[0])).toBe("[object Arguments]");
    expect(fakeWindow.dataLayer.map((entry) => Array.from(entry))).toEqual([
      ["config", "G-6PD78XKCZ6", { send_page_view: false }],
      ["event", "search_performed", {
        send_to: "G-6PD78XKCZ6",
        page_location: "https://itrader.im/",
        page_referrer: "",
        page_title: "iTrader | Isle of Man Vehicle Sales",
        category: "Cars",
      }],
    ]);
  });
});

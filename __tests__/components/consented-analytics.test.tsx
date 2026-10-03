// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://itrader.im/"}
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  COOKIE_CONSENT_STORAGE_KEY,
  buildCookieConsent,
  serializeCookieConsent,
} from "@/lib/consent/cookie-consent";

const { navigation } = vi.hoisted(() => ({ navigation: { pathname: "/" } }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

import { ConsentedAnalytics } from "@/components/layout/consented-analytics";

const MEASUREMENT_ID = "G-6PD78XKCZ6";

function queuedCommands(): unknown[][] {
  return (window.dataLayer ?? []).map((entry) => Array.from(entry));
}

function renderAnalytics(rerender?: (ui: React.ReactElement) => void) {
  const component = <ConsentedAnalytics enabled measurementId={MEASUREMENT_ID} />;
  return rerender ? (rerender(component), undefined) : render(component);
}

describe("consented GA4 browser collector", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
    navigation.pathname = "/";
    window.dataLayer = undefined;
    window.gtag = undefined;
    window.itraderGa4MeasurementId = undefined;
    window[`ga-disable-${MEASUREMENT_ID}`] = undefined;
    document.getElementById("itrader-google-analytics")?.remove();
    vi.restoreAllMocks();
  });

  it("waits for analytics consent and the tag load, tracks public SPA navigation, and stops on private routes or revocation", async () => {
    const originalAppend = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
      const result = originalAppend(node);
      if (node instanceof HTMLScriptElement && node.id === "itrader-google-analytics") {
        queueMicrotask(() => node.dispatchEvent(new Event("load")));
      }
      return result;
    });

    const view = renderAnalytics() as ReturnType<typeof render>;
    expect(document.getElementById("itrader-google-analytics")).toBeNull();
    expect(queuedCommands().some((command) => command[0] === "event")).toBe(false);

    act(() => {
      window.localStorage.setItem(
        COOKIE_CONSENT_STORAGE_KEY,
        serializeCookieConsent(buildCookieConsent(true)),
      );
      window.dispatchEvent(new Event("itrader:cookie-consent-changed"));
    });
    await waitFor(() => expect(window.itraderGa4MeasurementId).toBe(MEASUREMENT_ID));
    expect(queuedCommands().filter((command) => command[0] === "event")).toEqual([
      ["event", "page_view", expect.objectContaining({
        send_to: MEASUREMENT_ID,
        page_location: "https://itrader.im/",
        page_referrer: "",
        page_title: "iTrader | Isle of Man Vehicle Sales",
      })],
    ]);

    act(() => {
      window.history.pushState({}, "", "/search?email=private@example.com#results");
      navigation.pathname = "/search";
      view.rerender(<ConsentedAnalytics enabled measurementId={MEASUREMENT_ID} />);
    });
    await waitFor(() => expect(queuedCommands().filter((command) => command[0] === "event")).toHaveLength(2));
    expect(queuedCommands().filter((command) => command[0] === "event")[1]).toEqual([
      "event",
      "page_view",
      expect.objectContaining({
        send_to: MEASUREMENT_ID,
        page_location: "https://itrader.im/search",
        page_referrer: "https://itrader.im/",
      }),
    ]);

    act(() => {
      window.history.pushState({}, "", "/dealer/profile?email=private@example.com");
      navigation.pathname = "/dealer/profile";
      view.rerender(<ConsentedAnalytics enabled measurementId={MEASUREMENT_ID} />);
    });
    expect(window[`ga-disable-${MEASUREMENT_ID}`]).toBe(true);
    expect(window.itraderGa4MeasurementId).toBeUndefined();
    expect(document.getElementById("itrader-google-analytics")).toBeNull();
    expect(queuedCommands().filter((command) => command[0] === "event")).toHaveLength(2);

    act(() => {
      window.history.pushState({}, "", "/listings/vehicle-123");
      navigation.pathname = "/listings/vehicle-123";
      view.rerender(<ConsentedAnalytics enabled measurementId={MEASUREMENT_ID} />);
    });
    await waitFor(() => expect(queuedCommands().filter((command) => command[0] === "event")).toHaveLength(3));
    act(() => {
      window.localStorage.setItem(
        COOKIE_CONSENT_STORAGE_KEY,
        serializeCookieConsent(buildCookieConsent(false)),
      );
      window.dispatchEvent(new Event("itrader:cookie-consent-changed"));
    });
    expect(window[`ga-disable-${MEASUREMENT_ID}`]).toBe(true);
    expect(window.itraderGa4MeasurementId).toBeUndefined();
    expect(document.getElementById("itrader-google-analytics")).toBeNull();
  });
});

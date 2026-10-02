import { describe, expect, it } from "vitest";
import { sanitizeAnalyticsProperties } from "@/lib/analytics/events";
import { redactAnalyticsUrl } from "@/lib/analytics/privacy";
import { interpretVercelAlertRules } from "@/lib/monitoring/vercel-fallback";

describe("analytics contracts", () => {
  it("removes query data and personal event properties", () => {
    expect(redactAnalyticsUrl("https://itrader.im/search?q=alice@example.com"))
      .toBe("https://itrader.im/search");
    expect(sanitizeAnalyticsProperties({
      email: "alice@example.com",
      seller: "dealer",
      message: "hello",
    })).toEqual({ seller: "dealer" });
  });

  it("recognises an independent Vercel error alert", () => {
    expect(interpretVercelAlertRules([{ name: "Production error anomaly", enabled: true }])).toBe("configured");
    expect(interpretVercelAlertRules([{ name: "Spend warning", enabled: true }])).toBe("missing");
  });
});

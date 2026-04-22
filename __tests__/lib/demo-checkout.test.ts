import { describe, expect, it } from "vitest";
import {
  getRippleCheckoutMode,
  isRippleDemoCheckoutUrl,
} from "@/lib/payments/demo-checkout";

describe("Ripple demo checkout detection", () => {
  it("marks demo-gym card URLs as demo mode", () => {
    expect(
      getRippleCheckoutMode(
        "https://portal.startyourripple.co.uk/card/demo-gym/pay-any?title=Listing"
      )
    ).toBe("DEMO");
    expect(
      isRippleDemoCheckoutUrl(
        "https://portal.startyourripple.co.uk/card/demo-gym/subscribe"
      )
    ).toBe(true);
  });

  it("marks demo-gym portal URLs as demo mode", () => {
    expect(
      getRippleCheckoutMode(
        "https://portal.startyourripple.co.uk/portal/demo-gym/card-portal"
      )
    ).toBe("DEMO");
  });

  it("treats non-demo or invalid URLs as live mode", () => {
    expect(
      getRippleCheckoutMode("https://portal.startyourripple.co.uk/card/client-123/subscribe")
    ).toBe("LIVE");
    expect(isRippleDemoCheckoutUrl("https://example.com/pay")).toBe(false);
    expect(getRippleCheckoutMode("not a url")).toBe("LIVE");
    expect(getRippleCheckoutMode(null)).toBe("LIVE");
  });
});

import { describe, expect, it } from "vitest";
import {
  isSafeInternalReturnHref,
  resolveReturnHref,
} from "@/app/(public)/payment-return/page";

describe("payment return URL validation", () => {
  it("allows normal app-relative paths", () => {
    expect(isSafeInternalReturnHref("/sell/checkout?listing=abc")).toBe(true);
    expect(
      resolveReturnHref("/listings/abc?featured=true", "featured", "abc")
    ).toBe("/listings/abc?featured=true");
  });

  it("rejects protocol-relative return targets", () => {
    expect(isSafeInternalReturnHref("//evil.com")).toBe(false);
    expect(resolveReturnHref("//evil.com", "listing", "abc")).toBe(
      "/sell/checkout?listing=abc"
    );
  });
});

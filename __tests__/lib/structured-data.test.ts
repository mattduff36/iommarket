import { describe, expect, it } from "vitest";
import {
  buildBreadcrumbListJsonLd,
  buildCanonicalUrl,
  getCanonicalBaseUrl,
  serializeJsonLd,
} from "@/lib/seo/structured-data";

describe("structured data helpers", () => {
  it("accepts an origin-only canonical base URL", () => {
    const base = getCanonicalBaseUrl("https://itrader.im/");

    expect(base.toString()).toBe("https://itrader.im/");
    expect(
      buildCanonicalUrl("/dealers/alpha-autos", new URL("https://itrader.im/")),
    ).toBe("https://itrader.im/dealers/alpha-autos");
  });

  it("uses localhost only when configuration is absent outside production", () => {
    expect(getCanonicalBaseUrl(undefined, "test").toString()).toBe(
      "http://localhost:3000/",
    );
    expect(() =>
      getCanonicalBaseUrl(undefined, "production", undefined),
    ).toThrow(
      "set NEXT_PUBLIC_APP_URL or VERCEL_PROJECT_PRODUCTION_URL",
    );
  });

  it("uses the documented Vercel production host when the app URL is absent", () => {
    expect(
      getCanonicalBaseUrl(
        undefined,
        "production",
        "itrader-production.vercel.app",
      ).toString(),
    ).toBe("https://itrader-production.vercel.app/");
    expect(() =>
      getCanonicalBaseUrl(
        undefined,
        "production",
        "itrader-production.vercel.app/preview",
      ),
    ).toThrow("VERCEL_PROJECT_PRODUCTION_URL must not include a path");
  });

  it.each([
    ["a trailing path", "https://itrader.im/base/"],
    ["query data", "https://itrader.im/?campaign=test"],
    ["credentials", "https://user:secret@itrader.im/"],
    ["a non-web protocol", "javascript:alert(1)"],
    ["malformed input", "not a url"],
  ])("rejects canonical bases containing %s", (_label, configuredUrl) => {
    expect(() => getCanonicalBaseUrl(configuredUrl, "test")).toThrow();
  });

  it("rejects protocol-relative and external canonical item paths", () => {
    expect(() => buildCanonicalUrl("//evil.example/path")).toThrow(
      "root-relative",
    );
    expect(() => buildCanonicalUrl("https://evil.example/path")).toThrow(
      "root-relative",
    );
    expect(() => buildCanonicalUrl("/\\evil.example/path")).toThrow(
      "root-relative",
    );
  });

  it("uses consecutive one-based positions", () => {
    const data = buildBreadcrumbListJsonLd(
      [
        { label: "Home", href: "/" },
        { label: "Dealers", href: "/dealers" },
      ],
      new URL("https://itrader.im/"),
    );

    expect(data.itemListElement.map((item) => item.position)).toEqual([1, 2]);
  });

  it("escapes characters that can terminate an inline script", () => {
    const serialized = serializeJsonLd({
      value: "</script><img src=x onerror=alert(1)>&\u2028\u2029",
    });

    expect(serialized).not.toContain("<");
    expect(serialized).not.toContain(">");
    expect(serialized).not.toContain("&");
    expect(serialized).toContain("\\u003c/script\\u003e");
    expect(JSON.parse(serialized).value).toContain("</script>");
  });

  it.each([
    undefined,
    { missing: undefined },
    { callback: () => "nope" },
    { amount: BigInt(1) },
  ])("rejects undefined and non-serializable JSON-LD values", (value) => {
    expect(() => serializeJsonLd(value)).toThrow(
      "Failed to serialize JSON-LD",
    );
  });
});

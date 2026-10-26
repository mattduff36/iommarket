/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import { assertDesktopSourceUrl, desktopImageUrlRules } from "@/lib/dealer-stock-sync/desktop-source-policy";

describe("verified dealer photo hosts", () => {
  it.each([
    ["ingear-car-sales", "api.dealerwebsites.co.uk", "/images/a.jpg", "/other/a.jpg"],
    ["manx-car-warehouse", "smgmedia.blob.core.windows.net", "/images/130519/a.jpg", "/images/130520/a.jpg"],
  ])("scopes %s to exact verified photo paths", (key, host, allowed, denied) => {
    const rules = desktopImageUrlRules(key, "html-structured", "https://dealer.example");
    expect(assertDesktopSourceUrl(`https://${host}${allowed}`, rules)).toContain(allowed);
    for (const url of [`https://${host}${denied}`, `https://${host}.evil.example${allowed}`, `http://${host}${allowed}`, `https://${host}/images/../other/a.jpg`]) {
      expect(() => assertDesktopSourceUrl(url, rules)).toThrow();
    }
    expect(() => assertDesktopSourceUrl(`https://${host}${allowed}`, desktopImageUrlRules("other", "html-structured", null))).toThrow();
  });
});

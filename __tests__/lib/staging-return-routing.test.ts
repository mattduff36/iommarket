import { describe, expect, it } from "vitest";
import { checkoutRoutingCookie, stagingReturnDestination } from "@/lib/payments/staging-return-routing";

const now = 1790755200000;
const prod = { VERCEL_ENV: "production" };
const input = { method: "GET", cookie: `preview.${now}`, url: new URL("https://itrader.im/pay/success?paymentjobref=260921021772763472&redirect=https://evil.example") };

describe("staging return routing", () => {
  it("routes only to the fixed preview origin and copies provider fields only", () => {
    expect(stagingReturnDestination(input, prod, now)?.href).toBe("https://preview.itrader.im/pay/success?paymentjobref=260921021772763472");
  });
  it("does not redirect actions, non-return pages, other hosts or preview itself", () => {
    expect(stagingReturnDestination({ ...input, method: "POST" }, prod, now)).toBeNull();
    expect(stagingReturnDestination({ ...input, url: new URL("https://itrader.im/account") }, prod, now)).toBeNull();
    expect(stagingReturnDestination({ ...input, url: new URL("https://evil.example/pay/success") }, prod, now)).toBeNull();
    expect(stagingReturnDestination(input, { VERCEL_ENV: "preview" }, now)).toBeNull();
  });
  it("rejects missing, expired, future or arbitrary destination markers", () => {
    for (const cookie of [undefined, "https://evil.example", `preview.${now + 1}`, `preview.${now - 1800001}`]) {
      expect(stagingReturnDestination({ ...input, cookie }, prod, now)).toBeNull();
    }
  });
  it("sets only a low-privilege shared cookie on the staging domain and clears it for production checkout", () => {
    expect(checkoutRoutingCookie({ VERCEL_ENV: "preview", NEXT_PUBLIC_APP_URL: "https://preview.itrader.im" }, now)?.value).toBe(`preview.${now}`);
    expect(checkoutRoutingCookie(prod, now)?.options.maxAge).toBe(0);
    expect(checkoutRoutingCookie({ VERCEL_ENV: "preview", NEXT_PUBLIC_APP_URL: "https://branch.vercel.app" }, now)).toBeNull();
  });
});

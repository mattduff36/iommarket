import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CHECKOUT_ENVIRONMENT_COOKIE,
  CHECKOUT_RETURN_COOKIE,
  checkoutRoutingCookies,
  decideStagingCheckoutHandoff,
  presentHostedCheckoutUrl,
  STAGING_ORIGIN,
  stagingReturnDestination,
} from "@/lib/payments/staging-return-routing";

const now = 1790755200000;
const secret = "unit-test-relay-secret-32chars-minimum";
const clientId = "codelabplatfdcf3a8";
const ripple = `https://portal.startyourripple.co.uk/card/${clientId}/pay/AABBCCDDEEFF0011?reference=v1:listing_payment:listing:nonce:abcd`;
const stagingEnv = {
  VERCEL_ENV: "preview",
  NEXT_PUBLIC_APP_URL: STAGING_ORIGIN,
  RIPPLE_STAGING_RELAY_SECRET: secret,
  RIPPLE_CLIENT_ID: clientId,
};
const prod = { VERCEL_ENV: "production", RIPPLE_STAGING_RELAY_SECRET: secret, RIPPLE_CLIENT_ID: clientId };

function armedCookie() {
  const handoff = new URL(presentHostedCheckoutUrl(ripple, stagingEnv, now));
  const decision = decideStagingCheckoutHandoff({
    method: "GET", pathname: handoff.pathname, ticket: handoff.searchParams.get("ticket"), requestHost: "itrader.im",
  }, prod, now);
  if (decision.action !== "redirect") throw new Error("expected handoff");
  return decision;
}

describe("staging checkout handoff", () => {
  it("sends only an exact staging checkout through a signed production handoff", () => {
    const decision = armedCookie();
    expect(new URL(decision.location).searchParams.get("reference")).toBe("v1:listing_payment:listing:nonce:abcd");
    expect(new URL(decision.location).searchParams.has("name")).toBe(false);
    expect(new URL(decision.location).searchParams.has("email")).toBe(false);
    expect(decision.cookie.name).toBe(CHECKOUT_RETURN_COOKIE);
    expect(decision.cookie.options.domain).toBeUndefined();
    expect(decision.cookie.options.path).toBe("/pay");
    expect(decision.cookie.options.httpOnly).toBe(true);
    expect(new URL(presentHostedCheckoutUrl(ripple, stagingEnv, now)).origin).toBe("https://itrader.im");
  });

  it("does not wrap production, other previews, or a non-Ripple destination", () => {
    expect(presentHostedCheckoutUrl(ripple, prod, now)).toBe(ripple);
    expect(presentHostedCheckoutUrl(ripple, { ...stagingEnv, NEXT_PUBLIC_APP_URL: "https://branch.vercel.app" }, now)).toBe(ripple);
    expect(presentHostedCheckoutUrl(ripple, { ...stagingEnv, NEXT_PUBLIC_APP_URL: "https://staging.itrader.im" }, now)).toBe(ripple);
    expect(presentHostedCheckoutUrl("https://evil.example/pay", { VERCEL_ENV: "production" }, now)).toBe("https://evil.example/pay");
    expect(() => presentHostedCheckoutUrl("https://evil.example/pay", stagingEnv, now)).toThrow("STAGING_CHECKOUT_HANDOFF");
    expect(() => presentHostedCheckoutUrl(ripple, { ...stagingEnv, RIPPLE_STAGING_RELAY_SECRET: "short" }, now)).toThrow("STAGING_CHECKOUT_HANDOFF");
  });

  it("does not put the customer name or email in the production handoff URL", () => {
    const handoff = presentHostedCheckoutUrl(`${ripple}&name=Ada%20Lovelace&email=ada%40example.com`, stagingEnv, now);
    const ticket = new URL(handoff).searchParams.get("ticket") ?? "";
    const payload = JSON.parse(Buffer.from(ticket.split(".")[0] ?? "", "base64url").toString()) as { url: string };
    const destination = new URL(payload.url);
    expect(destination.pathname).toBe(`/card/${clientId}/pay/AABBCCDDEEFF0011`);
    expect(destination.searchParams.get("reference")).toBe("v1:listing_payment:listing:nonce:abcd");
    expect(destination.searchParams.has("name")).toBe(false);
    expect(destination.searchParams.has("email")).toBe(false);
    expect(handoff).not.toContain("Ada");
    expect(handoff).not.toContain("example.com");
  });

  it("rejects open redirects, tampering, expiry, the wrong host and preview itself", () => {
    const ticket = new URL(presentHostedCheckoutUrl(ripple, stagingEnv, now)).searchParams.get("ticket") ?? "";
    const swapped = `${ticket.slice(0, -1)}${ticket.endsWith("a") ? "b" : "a"}`;
    expect(decideStagingCheckoutHandoff({
      method: "GET", pathname: "/pay/staging-handoff", ticket: swapped, requestHost: "itrader.im",
    }, prod, now).action).toBe("reject");
    expect(decideStagingCheckoutHandoff({
      method: "GET", pathname: "/pay/staging-handoff", ticket, requestHost: "itrader.dev",
    }, prod, now).action).toBe("reject");
    expect(decideStagingCheckoutHandoff({
      method: "GET", pathname: "/pay/staging-handoff", ticket, requestHost: "itrader.im",
    }, prod, now + 1_800_001).action).toBe("reject");
    expect(decideStagingCheckoutHandoff({
      method: "GET", pathname: "/pay/staging-handoff", ticket, requestHost: "itrader.im",
    }, { ...prod, VERCEL_ENV: "preview" }, now).action).toBe("ignore");
    expect(decideStagingCheckoutHandoff({
      method: "POST", pathname: "/pay/staging-handoff", ticket, requestHost: "itrader.im",
    }, prod, now).action).toBe("ignore");
    const forged = (url: string) => {
      const payload = Buffer.from(JSON.stringify({ exp: now + 60_000, url })).toString("base64url");
      const mac = createHmac("sha256", secret).update(`itrader:checkout-handoff:v1:${payload}`).digest("hex");
      return `${payload}.${mac}`;
    };
    for (const url of [
      "https://evil.example/pay",
      "https://itrader.dev/pay/success",
      `https://portal.startyourripple.co.uk.evil.example/card/${clientId}/pay/AABBCCDDEEFF0011`,
      `https://user:pass@portal.startyourripple.co.uk/card/${clientId}/pay/AABBCCDDEEFF0011`,
      `http://portal.startyourripple.co.uk/card/${clientId}/pay/AABBCCDDEEFF0011`,
    ]) {
      expect(decideStagingCheckoutHandoff({
        method: "GET", pathname: "/pay/staging-handoff", ticket: forged(url), requestHost: "itrader.im",
      }, prod, now).action).toBe("reject");
    }
  });
});

describe("staging return routing", () => {
  it("routes a signed host cookie only to the fixed staging origin and copies provider fields only", () => {
    const cookie = armedCookie().cookie.value;
    const input = {
      method: "GET", cookie,
      url: new URL("https://itrader.im/pay/success?paymentjobref=260921021772763472&redirect=https://evil.example"),
    };
    expect(stagingReturnDestination(input, prod, now)?.href).toBe(`${STAGING_ORIGIN}/pay/success?paymentjobref=260921021772763472`);
    expect(stagingReturnDestination({ ...input, method: "POST" }, prod, now)).toBeNull();
    expect(stagingReturnDestination({ ...input, url: new URL("https://itrader.im/account") }, prod, now)).toBeNull();
    expect(stagingReturnDestination({ ...input, url: new URL("https://evil.example/pay/success") }, prod, now)).toBeNull();
    expect(stagingReturnDestination(input, { VERCEL_ENV: "preview" }, now)).toBeNull();
  });

  it("rejects the old shared-domain marker and missing, expired or forged cookies", () => {
    const cookie = armedCookie().cookie.value;
    const input = { method: "GET", url: new URL("https://itrader.im/pay/success?paymentjobref=1") };
    for (const rejected of [undefined, `preview.${now}`, cookie.slice(0, -1) + (cookie.endsWith("a") ? "b" : "a")]) {
      expect(stagingReturnDestination({ ...input, cookie: rejected }, prod, now)).toBeNull();
    }
    expect(stagingReturnDestination({ ...input, cookie }, prod, now + 1_800_001)).toBeNull();
  });

  it("uses the exact incoming host when Vercel normalizes the request URL", () => {
    const cookie = armedCookie().cookie.value;
    const normalized = { method: "GET", cookie, url: new URL("https://deployment.vercel.app/pay/success?paymentjobref=123") };
    expect(stagingReturnDestination({ ...normalized, requestHost: "itrader.im" }, prod, now)?.href)
      .toBe(`${STAGING_ORIGIN}/pay/success?paymentjobref=123`);
    for (const requestHost of [null, "itrader.dev", "staging.itrader.im", "evil.example", "itrader.im.evil.example"]) {
      expect(stagingReturnDestination({ ...normalized, requestHost }, prod, now)).toBeNull();
    }
  });

  it("does not set a parent-domain cookie on staging and clears both markers for production checkout", () => {
    expect(checkoutRoutingCookies(stagingEnv)).toEqual([]);
    const clears = checkoutRoutingCookies(prod);
    expect(clears.map((cookie) => cookie.name)).toEqual([CHECKOUT_RETURN_COOKIE, CHECKOUT_ENVIRONMENT_COOKIE]);
    expect(clears.every((cookie) => cookie.options.maxAge === 0)).toBe(true);
    expect(clears[0]?.options.domain).toBeUndefined();
    expect(clears[1]?.options.domain).toBe(".itrader.im");
    expect(checkoutRoutingCookies({ VERCEL_ENV: "preview", NEXT_PUBLIC_APP_URL: "https://preview.itrader.im" })).toEqual([]);
  });
});

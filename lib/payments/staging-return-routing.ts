import { createHmac, timingSafeEqual } from "node:crypto";
import { isStagingAppOrigin, STAGING_ORIGIN } from "@/lib/deployment/staging-origin";
import { isPaymentReturnPath } from "@/lib/payments/return-routes";
import { RIPPLE_PAYMENT_ORIGIN } from "@/lib/payments/ripple-config";

export { STAGING_ORIGIN };
export const CHECKOUT_ENVIRONMENT_COOKIE = "itrader-checkout-environment";
export const CHECKOUT_RETURN_COOKIE = "itrader-checkout-return";
export const STAGING_CHECKOUT_HANDOFF_PATH = "/pay/staging-handoff";
export const CHECKOUT_ROUTING_MAX_AGE = 30 * 60;

const PRODUCTION_ORIGIN = "https://itrader.im";
const TICKET_CONTEXT = "itrader:checkout-handoff:v1:";
const COOKIE_CONTEXT = "itrader:checkout-return:v1:";
const MAX_TICKET_LENGTH = 2048;

type Env = Record<string, string | undefined>;

export type CheckoutRoutingCookie = {
  name: typeof CHECKOUT_ENVIRONMENT_COOKIE | typeof CHECKOUT_RETURN_COOKIE;
  value: string;
  options: {
    domain?: ".itrader.im";
    path: "/pay";
    secure: true;
    httpOnly: true;
    sameSite: "lax";
    maxAge: number;
  };
};

export type HandoffDecision =
  | { action: "ignore" }
  | { action: "reject" }
  | { action: "redirect"; location: string; cookie: CheckoutRoutingCookie };

function relaySecret(env: Env) {
  const secret = env.RIPPLE_STAGING_RELAY_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

function mac(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function signaturesMatch(supplied: string, expected: string) {
  if (!/^[a-f0-9]{64}$/.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"));
}

function hostCookie(value: string, maxAge: number): CheckoutRoutingCookie {
  return {
    name: CHECKOUT_RETURN_COOKIE,
    value,
    options: { path: "/pay", secure: true, httpOnly: true, sameSite: "lax", maxAge },
  };
}

function legacyDomainClear(): CheckoutRoutingCookie {
  return {
    name: CHECKOUT_ENVIRONMENT_COOKIE,
    value: "",
    options: {
      domain: ".itrader.im", path: "/pay", secure: true, httpOnly: true, sameSite: "lax", maxAge: 0,
    },
  };
}

/** Production clears both the host-only marker and any leftover parent-domain cookie. */
export function checkoutRoutingCookies(env: Env = process.env): CheckoutRoutingCookie[] {
  if (env.VERCEL_ENV !== "production") return [];
  return [hostCookie("", 0), legacyDomainClear()];
}

export function checkoutReturnClears(): CheckoutRoutingCookie[] {
  return [hostCookie("", 0), legacyDomainClear()];
}

export function allowlistedRippleCheckoutUrl(value: string, env: Env = process.env): URL | null {
  const clientId = env.RIPPLE_CLIENT_ID?.trim() ?? "";
  if (!/^[A-Za-z0-9]{8,64}$/.test(clientId) || value.length > 1500) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const path = new RegExp(`^/card/${clientId}/pay/[A-F0-9]{16,64}$`, "i");
  if (url.origin !== RIPPLE_PAYMENT_ORIGIN || url.username || url.password || url.port || url.hash) return null;
  if (!path.test(url.pathname)) return null;
  return url;
}

export function presentHostedCheckoutUrl(rippleUrl: string, env: Env = process.env, now = Date.now()): string {
  const staging = env.VERCEL_ENV === "preview" && isStagingAppOrigin(env.NEXT_PUBLIC_APP_URL);
  if (!staging) return rippleUrl;
  const secret = relaySecret(env);
  const checkout = allowlistedRippleCheckoutUrl(rippleUrl, env);
  if (!secret || !checkout) throw new Error("STAGING_CHECKOUT_HANDOFF");
  checkout.searchParams.delete("name");
  checkout.searchParams.delete("email");
  const exp = now + CHECKOUT_ROUTING_MAX_AGE * 1000;
  const payload = Buffer.from(JSON.stringify({ exp, url: checkout.href })).toString("base64url");
  const ticket = `${payload}.${mac(secret, TICKET_CONTEXT + payload)}`;
  const handoff = new URL(STAGING_CHECKOUT_HANDOFF_PATH, PRODUCTION_ORIGIN);
  handoff.searchParams.set("ticket", ticket);
  return handoff.href;
}

function readTicket(ticket: string, env: Env, now: number) {
  const secret = relaySecret(env);
  if (!secret || ticket.length > MAX_TICKET_LENGTH) return null;
  const [payload, supplied, extra] = ticket.split(".");
  if (!payload || !supplied || extra !== undefined || !signaturesMatch(supplied, mac(secret, TICKET_CONTEXT + payload))) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!parsed || typeof parsed !== "object" || !("exp" in parsed) || !("url" in parsed)) return null;
    const { exp, url } = parsed as { exp: unknown; url: unknown };
    if (typeof exp !== "number" || !Number.isSafeInteger(exp) || typeof url !== "string") return null;
    if (exp < now || exp > now + CHECKOUT_ROUTING_MAX_AGE * 1000) return null;
    const checkout = allowlistedRippleCheckoutUrl(url, env);
    if (!checkout || checkout.href !== url) return null;
    return { exp, url: checkout };
  } catch {
    return null;
  }
}

export function decideStagingCheckoutHandoff(input: {
  method: string; pathname: string; ticket: string | null; requestHost?: string | null;
}, env: Env = process.env, now = Date.now()): HandoffDecision {
  if (input.method !== "GET" || input.pathname !== STAGING_CHECKOUT_HANDOFF_PATH) return { action: "ignore" };
  if (env.VERCEL_ENV !== "production") return { action: "ignore" };
  const secret = relaySecret(env);
  const claims = input.requestHost === "itrader.im" && input.ticket && secret
    ? readTicket(input.ticket, env, now) : null;
  if (!claims || !secret) return { action: "reject" };
  const value = `v1.${claims.exp}.${mac(secret, `${COOKIE_CONTEXT}${claims.exp}`)}`;
  const maxAge = Math.max(1, Math.ceil((claims.exp - now) / 1000));
  return { action: "redirect", location: claims.url.href, cookie: hostCookie(value, maxAge) };
}

function markerIsCurrent(cookie: string | undefined, env: Env, now: number) {
  const secret = relaySecret(env);
  const match = cookie ? /^v1\.(\d{1,16})\.([a-f0-9]{64})$/.exec(cookie) : null;
  if (!secret || !match) return false;
  const exp = Number(match[1]);
  if (!Number.isSafeInteger(exp) || exp < now || exp > now + CHECKOUT_ROUTING_MAX_AGE * 1000) return false;
  return signaturesMatch(match[2], mac(secret, `${COOKIE_CONTEXT}${exp}`));
}

export function stagingReturnDestination(input: {
  url: URL; method: string; cookie?: string; requestHost?: string | null;
}, env: Env = process.env, now = Date.now()): URL | null {
  const productionHost = input.requestHost === undefined
    ? input.url.origin === PRODUCTION_ORIGIN
    : input.requestHost === "itrader.im";
  if (env.VERCEL_ENV !== "production" || input.method !== "GET" ||
      !productionHost || !isPaymentReturnPath(input.url.pathname) ||
      !markerIsCurrent(input.cookie, env, now)) return null;
  const destination = new URL(input.url.pathname, STAGING_ORIGIN);
  for (const key of ["status", "paymentjobref", "paymentref", "ordernumber"]) {
    const values = input.url.searchParams.getAll(key);
    if (values.length === 1 && values[0].length <= 100) destination.searchParams.set(key, values[0]);
  }
  return destination;
}

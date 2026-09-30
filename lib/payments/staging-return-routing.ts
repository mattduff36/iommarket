import { isPaymentReturnPath } from "@/lib/payments/return-routes";

export const CHECKOUT_ENVIRONMENT_COOKIE = "itrader-checkout-environment";
export const STAGING_ORIGIN = "https://preview.itrader.im";
export const CHECKOUT_ROUTING_MAX_AGE = 30 * 60;

// This cookie only chooses a fixed destination. It never authenticates a user
// or confirms payment; the signed checkout context remains host-only.
export function checkoutRoutingCookie(env: Record<string, string | undefined> = process.env, now = Date.now()) {
  const preview = env.VERCEL_ENV === "preview" && env.NEXT_PUBLIC_APP_URL === STAGING_ORIGIN;
  const production = env.VERCEL_ENV === "production";
  if (!preview && !production) return null;
  return {
    name: CHECKOUT_ENVIRONMENT_COOKIE,
    value: preview ? `preview.${now}` : "",
    options: {
      domain: ".itrader.im", path: "/pay", secure: true, httpOnly: true,
      sameSite: "lax" as const, maxAge: preview ? CHECKOUT_ROUTING_MAX_AGE : 0,
    },
  };
}

export function stagingReturnDestination(input: {
  url: URL; method: string; cookie?: string;
}, env: Record<string, string | undefined> = process.env, now = Date.now()): URL | null {
  if (env.VERCEL_ENV !== "production" || input.method !== "GET" ||
      input.url.origin !== "https://itrader.im" || !isPaymentReturnPath(input.url.pathname)) return null;
  const match = /^preview\.(\d{13})$/.exec(input.cookie ?? "");
  if (!match) return null;
  const age = now - Number(match[1]);
  if (age < 0 || age > CHECKOUT_ROUTING_MAX_AGE * 1000) return null;
  const destination = new URL(input.url.pathname, STAGING_ORIGIN);
  for (const key of ["status", "paymentjobref", "paymentref", "ordernumber"]) {
    const values = input.url.searchParams.getAll(key);
    if (values.length === 1 && values[0].length <= 100) destination.searchParams.set(key, values[0]);
  }
  return destination;
}

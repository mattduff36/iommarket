const RIPPLE_DEMO_HOST = "portal.startyourripple.co.uk";
const RIPPLE_DEMO_CLIENT_ID = "demo-gym";

export type RippleCheckoutMode = "LIVE" | "DEMO";

export function getRippleCheckoutMode(
  checkoutUrl: string | null | undefined
): RippleCheckoutMode {
  if (!checkoutUrl) return "LIVE";

  try {
    const url = new URL(checkoutUrl);
    const isDemoHost = url.hostname === RIPPLE_DEMO_HOST;
    const isDemoPath = new RegExp(
      `^/(card|portal)/${RIPPLE_DEMO_CLIENT_ID}(?:/|$)`
    ).test(url.pathname);

    return isDemoHost && isDemoPath ? "DEMO" : "LIVE";
  } catch {
    return "LIVE";
  }
}

export function isRippleDemoCheckoutUrl(
  checkoutUrl: string | null | undefined
): boolean {
  return getRippleCheckoutMode(checkoutUrl) === "DEMO";
}

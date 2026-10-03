export function redactAnalyticsUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.split("?")[0]?.split("#")[0] ?? url;
  }
}

const PRIVATE_PATH_PREFIXES = [
  "/account",
  "/admin",
  "/api",
  "/auth",
  "/checkout",
  "/correspondence",
  "/dealer",
  "/login",
  "/logout",
  "/password",
  "/payments",
  "/profile",
  "/sample-checkout",
  "/sell/create",
  "/sell/checkout",
  "/sell/success",
  "/signup",
  "/verify",
];

export function isAnalyticsPathAllowed(pathname: string): boolean {
  const pathOnly = pathname.split(/[?#]/, 1)[0] ?? "/";
  const normalized = (pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`).toLowerCase();
  return !PRIVATE_PATH_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

export interface SafePageView {
  page_location: string;
  page_referrer: string;
  page_title: "iTrader | Isle of Man Vehicle Sales";
}

export function safeAnalyticsPageView(input: {
  protocol: string;
  hostname: string;
  pathname: string;
  referrer?: string;
}): SafePageView | null {
  const host = input.hostname.toLowerCase();
  if (host !== "itrader.im" && host !== "www.itrader.im") return null;
  const pathname = (input.pathname.split(/[?#]/, 1)[0] || "/");
  if (!isAnalyticsPathAllowed(pathname)) return null;

  const pageView: SafePageView = {
    page_location: `https://${host}${pathname}`,
    page_referrer: "",
    page_title: "iTrader | Isle of Man Vehicle Sales",
  };

  if (input.referrer) {
    try {
      const referrer = new URL(input.referrer);
      if (
        (referrer.protocol === "http:" || referrer.protocol === "https:") &&
        referrer.hostname &&
        isAnalyticsPathAllowed(referrer.pathname)
      ) {
        pageView.page_referrer = `${referrer.origin}${referrer.pathname}`;
      }
    } catch {
      // A malformed referrer is omitted rather than forwarded.
    }
  }

  return pageView;
}

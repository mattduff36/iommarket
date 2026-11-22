import { DEALER_REGISTRY } from "@/scripts/dealer-stock-sync/registry";
import { assertDesktopSourceUrl, desktopDetailUrlRules } from "./desktop-source-policy";

export function publicDetailLink(key?: string | null, raw?: string | null) {
  if (!raw || !key) return null;
  const dealer = DEALER_REGISTRY.find((entry) => entry.key === key);
  if (!dealer) return null;
  try {
    const rules = dealer.sources.flatMap((source) => desktopDetailUrlRules(source.startUrl));
    const href = assertDesktopSourceUrl(raw, rules);
    if (new URL(href).pathname === "/" || dealer.stockUrls.includes(href)) return null;
    return href;
  } catch {
    return null;
  }
}

import { createWebsiteConnector } from "./website-source";

export const clickDealerConnector = createWebsiteConnector({
  key: "click-dealer",
  detect({ url, html, requestUrls }) {
    const haystack = [url, html, ...(requestUrls ?? [])].join("\n").toLowerCase();
    return haystack.includes("clickdealer") || haystack.includes("click-dealer") || haystack.includes("click dealer");
  },
  requestMatch: (requestUrl) => /loadSearch\.php|ajax\/.*search/i.test(requestUrl),
  preferBrowser: true,
  settleMs: 4_000,
});

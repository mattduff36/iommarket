import { createWebsiteConnector } from "./website-source";

export const dragon2000Connector = createWebsiteConnector({
  key: "dragon2000",
  detect({ url, html, requestUrls }) {
    const haystack = [url, html, ...(requestUrls ?? [])].join("\n").toLowerCase();
    return haystack.includes("dragon2000") || haystack.includes("dragon-2000");
  },
  requestMatch: (requestUrl) => /\/api\/(?:v2\/)?vehicles\/(?:instock|search-data)/i.test(requestUrl),
  preferBrowser: true,
  settleMs: 2_000,
  waitForSelector: ".stocklist-vehicle",
});

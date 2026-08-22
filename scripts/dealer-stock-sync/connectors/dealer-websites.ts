import { createWebsiteConnector } from "./website-source";

export const dealerWebsitesConnector = createWebsiteConnector({
  key: "dealer-websites",
  detect({ url, html, requestUrls }) {
    const haystack = [url, html, ...(requestUrls ?? [])].join("\n").toLowerCase();
    return haystack.includes("dealerwebsites") || haystack.includes("dealer-websites") || haystack.includes("dealer websites");
  },
  requestMatch: (requestUrl) => /dealerwebsite|stock|vehicle/i.test(requestUrl),
});

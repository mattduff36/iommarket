import { createWebsiteConnector } from "./website-source";

export const iomwebdesignConnector = createWebsiteConnector({
  key: "iomwebdesign",
  detect({ url, html, requestUrls }) {
    const haystack = [url, html, ...(requestUrls ?? [])].join("\n").toLowerCase();
    return haystack.includes("iomwebdesign") || haystack.includes("iom web design");
  },
  requestMatch: (requestUrl) => /stock|vehicle|cars/i.test(requestUrl),
});

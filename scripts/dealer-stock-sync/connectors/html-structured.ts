import { createWebsiteConnector } from "./website-source";

export const htmlStructuredConnector = createWebsiteConnector({
  key: "html-structured",
  detect({ html }) {
    if (!html) return false;
    return (
      html.includes("application/ld+json") ||
      html.includes("__NEXT_DATA__") ||
      /"vehicles"\s*:/.test(html) ||
      /cdinv-card|property-listing|car-view1-wrapper|new-price|car-for-sale-peel|list-box-wrapper|makemodel|showroom-preowned|vehicles-list|vehicle-make-model|detail mileage|bsk-vehicle-card|u-products-item/i.test(
        html,
      )
    );
  },
  preferBrowser: false,
});

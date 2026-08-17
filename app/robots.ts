import type { MetadataRoute } from "next";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api"],
    },
    sitemap: buildCanonicalUrl("/sitemap.xml"),
  };
}

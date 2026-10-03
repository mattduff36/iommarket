import type { MetadataRoute } from "next";
import { shouldEnforceLaunchGate } from "@/lib/launch/gate";
import type { RuntimeEnv } from "@/lib/runtime-env";
import { isSearchIndexingEnabled } from "@/lib/seo/indexing-policy";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";

const CRAWLABLE_RULES = {
  userAgent: "*",
  allow: "/",
  disallow: ["/admin", "/api"],
};

export function buildLaunchRobots(
  env: RuntimeEnv = process.env,
  now = Date.now(),
): MetadataRoute.Robots {
  if (shouldEnforceLaunchGate(env, now)) {
    return {
      rules: {
        userAgent: "*",
        disallow: "/",
      },
    };
  }

  if (!isSearchIndexingEnabled(env, now)) {
    return { rules: CRAWLABLE_RULES };
  }

  return {
    rules: CRAWLABLE_RULES,
    sitemap: buildCanonicalUrl("/sitemap.xml"),
  };
}

export async function buildLaunchSitemap(
  env: RuntimeEnv,
  loadLiveEntries: () => Promise<MetadataRoute.Sitemap>,
  now = Date.now(),
): Promise<MetadataRoute.Sitemap> {
  if (!isSearchIndexingEnabled(env, now)) return [];
  return loadLiveEntries();
}

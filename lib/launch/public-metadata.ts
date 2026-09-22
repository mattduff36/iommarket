import type { MetadataRoute } from "next";
import { shouldEnforceLaunchGate } from "@/lib/launch/gate";
import type { RuntimeEnv } from "@/lib/runtime-env";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";

export function buildLaunchRobots(
  env: RuntimeEnv = process.env,
): MetadataRoute.Robots {
  if (shouldEnforceLaunchGate(env)) {
    return {
      rules: {
        userAgent: "*",
        disallow: "/",
      },
    };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api"],
    },
    sitemap: buildCanonicalUrl("/sitemap.xml"),
  };
}

export async function buildLaunchSitemap(
  env: RuntimeEnv,
  loadLiveEntries: () => Promise<MetadataRoute.Sitemap>,
): Promise<MetadataRoute.Sitemap> {
  if (shouldEnforceLaunchGate(env)) return [];
  return loadLiveEntries();
}

import type { MetadataRoute } from "next";
import { buildLaunchRobots } from "@/lib/launch/public-metadata";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return buildLaunchRobots();
}

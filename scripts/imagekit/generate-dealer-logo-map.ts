import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { db } from "@/lib/db";
import { loadMigrationIndex } from "@/lib/media/migration-index";
import {
  cloudinaryIdentityFromUrl,
  matchMediaReference,
} from "@/lib/media/match-reference";

const mapPath = process.env.IMAGEKIT_MIGRATION_MAP;
if (!mapPath) throw new Error("IMAGEKIT_MIGRATION_MAP is not configured.");

async function main() {
  const index = loadMigrationIndex(mapPath!);
  const dealers = await db.dealerProfile.findMany({
    where: { logoUrl: { not: null } },
    select: { logoUrl: true },
  });
  const entries: Array<[
    string,
    { destinationPath: string; resourceType: "image" | "video" },
  ]> = [];

  for (const dealer of dealers) {
    const url = new URL(dealer.logoUrl!).toString();
    const identity = cloudinaryIdentityFromUrl(url);
    if (!identity) continue;
    const match = matchMediaReference({
      provider: "CLOUDINARY",
      publicId: identity.publicId,
      version: identity.version,
      url,
    }, index);
    if (
      !match.asset ||
      (match.kind !== "exact-public-id-version" && match.kind !== "exact-asset-id") ||
      (match.asset.resourceType !== "image" && match.asset.resourceType !== "video")
    ) {
      continue;
    }
    entries.push([
      createHash("sha256").update(url).digest("hex"),
      {
        destinationPath: match.asset.destinationPath,
        resourceType: match.asset.resourceType,
      },
    ]);
  }

  entries.sort(([left], [right]) => left.localeCompare(right));
  const source = `import { createHash } from "node:crypto";

type MigratedDealerLogo = { destinationPath: string; resourceType: "image" | "video" };

// Generated from the reviewed 7,677-asset migration map. Source URLs are hashed.
const MIGRATED_DEALER_LOGOS = new Map<string, MigratedDealerLogo>(${JSON.stringify(entries, null, 2)});
export const MIGRATED_DEALER_LOGO_COUNT = MIGRATED_DEALER_LOGOS.size;

export function findMigratedDealerLogo(url: string): MigratedDealerLogo | null {
  const key = createHash("sha256").update(url).digest("hex");
  return MIGRATED_DEALER_LOGOS.get(key) ?? null;
}
`;
  writeFileSync("lib/media/migrated-dealer-logos.ts", source);
  console.log(JSON.stringify({ generatedDealerLogoMappings: entries.length }));
  await db.$disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : "Dealer logo map generation failed.");
  await db.$disconnect().catch(() => undefined);
  process.exit(1);
});

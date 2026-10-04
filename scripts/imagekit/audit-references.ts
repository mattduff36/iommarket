import { mkdirSync, writeFileSync } from "node:fs";
import { db } from "@/lib/db";
import { loadMigrationIndex } from "@/lib/media/migration-index";
import { cloudinaryIdentityFromUrl, matchMediaReference, type ReferenceMatchKind } from "@/lib/media/match-reference";

const developmentRef = "syneonzucehwlghqmfbg";
const productionRef = "snlqivvogfqesxpbjiei";

function assertDevelopmentDatabase() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!databaseUrl.includes(developmentRef) || !supabaseUrl.includes(developmentRef)) {
    throw new Error("Reference audit refused: database is not the verified development project.");
  }
  if (databaseUrl.includes(productionRef) || supabaseUrl.includes(productionRef)) {
    throw new Error("Reference audit refused: database points at production.");
  }
}

function hostOf(url: string | null) {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return "unparseable";
  }
}

async function main() {
  assertDevelopmentDatabase();
  const mapPath = process.env.IMAGEKIT_MIGRATION_MAP;
  if (!mapPath) throw new Error("IMAGEKIT_MIGRATION_MAP is not configured.");
  const index = loadMigrationIndex(mapPath);
  const [images, revisions, users, dealers] = await Promise.all([
    db.listingImage.findMany({
      select: { id: true, listingId: true, provider: true, assetId: true, publicId: true, version: true, url: true, format: true },
    }),
    db.listingRevisionImage.findMany({
      select: { id: true, revisionId: true, provider: true, assetId: true, publicId: true, version: true, url: true, format: true },
    }),
    db.user.findMany({ where: { avatarUrl: { not: null } }, select: { id: true, avatarUrl: true } }),
    db.dealerProfile.findMany({ where: { logoUrl: { not: null } }, select: { id: true, logoUrl: true } }),
  ]);

  const counts: Record<string, number> = {};
  const unresolved: Array<Record<string, string>> = [];
  const ambiguous: Array<Record<string, string>> = [];
  function add(kind: ReferenceMatchKind | string) {
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  function classify(table: string, row: { id: string; provider: string; assetId: string | null; publicId: string; version: string | null; url: string }) {
    const match = matchMediaReference(row, index);
    add(`${table}:${match.kind}`);
    if (match.kind === "ambiguous") {
      ambiguous.push({ table, id: row.id, publicId: row.publicId, version: row.version ?? "" });
    }
    if (match.kind === "missing") {
      unresolved.push({ table, id: row.id, publicId: row.publicId, version: row.version ?? "", reason: match.reason });
    }
    return match;
  }

  const resolvedIds: string[] = [];
  for (const image of images) {
    const match = classify("ListingImage", image);
    if (match.asset) resolvedIds.push(image.id);
  }
  for (const image of revisions) {
    const match = classify("ListingRevisionImage", image);
    if (match.asset) resolvedIds.push(image.id);
  }

  const avatarHosts: Record<string, number> = {};
  for (const user of users) {
    const host = hostOf(user.avatarUrl) ?? "empty";
    avatarHosts[host] = (avatarHosts[host] ?? 0) + 1;
  }
  const logoHosts: Record<string, number> = {};
  const logoMatches: Record<string, number> = {};
  for (const dealer of dealers) {
    const host = hostOf(dealer.logoUrl) ?? "empty";
    logoHosts[host] = (logoHosts[host] ?? 0) + 1;
    const identity = cloudinaryIdentityFromUrl(dealer.logoUrl);
    const match = identity
      ? matchMediaReference({ provider: "CLOUDINARY", publicId: identity.publicId, version: identity.version, url: dealer.logoUrl }, index)
      : { kind: "not-cloudinary" as const };
    logoMatches[match.kind] = (logoMatches[match.kind] ?? 0) + 1;
    if (match.kind === "missing" || match.kind === "ambiguous") {
      unresolved.push({ table: "DealerProfile", id: dealer.id, publicId: identity?.publicId ?? "", version: identity?.version ?? "", reason: match.kind });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    database: developmentRef,
    snapshotOriginals: index.count,
    listingImages: images.length,
    revisionImages: revisions.length,
    counts,
    unresolved,
    ambiguous,
    resolvedListingOrRevisionIds: resolvedIds.length,
    avatars: { count: users.length, hosts: avatarHosts, cloudinaryMatches: 0 },
    logos: { count: dealers.length, hosts: logoHosts, matches: logoMatches },
    note: "Avatar and logo rows are classified by host. They are not guessed into the Cloudinary snapshot.",
  };
  mkdirSync("tmp", { recursive: true });
  writeFileSync("tmp/imagekit-reference-audit.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    snapshotOriginals: report.snapshotOriginals,
    listingImages: report.listingImages,
    revisionImages: report.revisionImages,
    counts: report.counts,
    unresolved: report.unresolved.length,
    ambiguous: report.ambiguous.length,
    avatarHosts: report.avatars.hosts,
    logoHosts: report.logos.hosts,
    logoMatches: report.logos.matches,
  }, null, 2));
  await db.$disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : "Reference audit failed.");
  await db.$disconnect().catch(() => undefined);
  process.exit(1);
});

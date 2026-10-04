import { db } from "@/lib/db";
import { loadMigrationIndex, publicVersionKey } from "@/lib/media/migration-index";

async function main() {
const index = loadMigrationIndex(process.env.IMAGEKIT_MIGRATION_MAP ?? "");
const rows = await db.listingImage.findMany({
  select: { provider: true, assetId: true, publicId: true, url: true, format: true, version: true },
});
const hosts: Record<string, number> = {};
let externalAssetInMap = 0;
let externalDemo = 0;
let externalUnmapped = 0;
let externalExactVersion = 0;
let externalPublicOnly = 0;
const prefixes: Record<string, number> = {};
const formats: Record<string, number> = {};
for (const row of rows) {
  let host = "unparseable";
  try {
    host = new URL(row.url).host;
  } catch {
    host = "not-a-url";
  }
  const key = `${row.provider}:${host}`;
  hosts[key] = (hosts[key] ?? 0) + 1;
  formats[`${row.provider}:${row.format ?? "none"}`] = (formats[`${row.provider}:${row.format ?? "none"}`] ?? 0) + 1;
  if (row.provider !== "CLOUDINARY") {
    if (row.publicId.startsWith("demo/")) externalDemo += 1;
    else if (row.assetId && index.byAssetId.has(row.assetId)) externalAssetInMap += 1;
    else if (row.version && index.byPublicVersion.has(publicVersionKey(row.publicId, row.version))) externalExactVersion += 1;
    else if (index.byPublicId.has(row.publicId)) externalPublicOnly += 1;
    else {
      externalUnmapped += 1;
      const prefix = row.publicId.includes("/") ? row.publicId.split("/")[0] ?? "(empty)" : "(no-slash)";
      prefixes[prefix] = (prefixes[prefix] ?? 0) + 1;
    }
  }
}
const logos = await db.dealerProfile.findMany({
  where: { logoUrl: { not: null } },
  select: { logoUrl: true },
});
const logoPaths = logos.map((logo) => {
  try {
    const url = new URL(logo.logoUrl ?? "");
    return { host: url.host, path: url.pathname.split("/").slice(0, 4).join("/") };
  } catch {
    return { host: "unparseable", path: "" };
  }
});
function identityFromCloudinaryUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const marker = parsed.pathname.includes("/image/private/")
    ? "/image/private/"
    : parsed.pathname.includes("/image/upload/")
      ? "/image/upload/"
      : null;
  if (!marker || parsed.host !== "res.cloudinary.com") return null;
  let rest = decodeURIComponent(parsed.pathname.slice(parsed.pathname.indexOf(marker) + marker.length));
  rest = rest.replace(/^s--[A-Za-z0-9_-]+--\//, "");
  const versionMatch = /^v(\d+)\//.exec(rest);
  const version = versionMatch?.[1] ?? "";
  if (versionMatch) rest = rest.slice(versionMatch[0].length);
  const publicId = rest.replace(/\.[a-z0-9]+$/i, "");
  if (!publicId || publicId.includes("..")) return null;
  return { publicId, version };
}

let urlExact = 0;
let urlPublicOnly = 0;
let urlMissing = 0;
let urlUnparsed = 0;
for (const row of rows) {
  if (row.provider === "CLOUDINARY") continue;
  const identity = identityFromCloudinaryUrl(row.url);
  if (!identity) {
    urlUnparsed += 1;
    continue;
  }
  if (identity.version && index.byPublicVersion.has(publicVersionKey(identity.publicId, identity.version))) urlExact += 1;
  else if (index.byPublicId.has(identity.publicId)) urlPublicOnly += 1;
  else urlMissing += 1;
}

console.log(JSON.stringify({
  hosts,
  formats,
  externalAssetInMap,
  externalExactVersion,
  externalPublicOnly,
  externalDemo,
  externalUnmapped,
  prefixes,
  logoPaths,
  externalCloudinaryUrl: { urlExact, urlPublicOnly, urlMissing, urlUnparsed },
}, null, 2));
await db.$disconnect();
}
main();

import type { MediaReference, ReferenceMatch } from "@/lib/media/match-reference";

export type ImageKitBackfillDecision =
  | {
      action: "write";
      fileId: string;
      filePath: string;
      kind: "exact-asset-id" | "exact-public-id-version";
    }
  | { action: "unchanged"; fileId: string; filePath: string }
  | { action: "refuse"; reason: string };

export function decideImageKitBackfill(input: {
  match: ReferenceMatch;
  reference: MediaReference & {
    imageKitFileId?: string | null;
    imageKitFilePath?: string | null;
  };
}): ImageKitBackfillDecision {
  const kind = input.match.kind;
  const asset = input.match.asset;
  if ((kind !== "exact-asset-id" && kind !== "exact-public-id-version") || !asset) {
    return { action: "refuse", reason: input.match.reason };
  }
  if (input.reference.assetId && input.reference.assetId !== asset.assetId) {
    return { action: "refuse", reason: "Asset id does not match the migrated original." };
  }
  if (input.reference.version && input.reference.version !== asset.sourceVersion) {
    return { action: "refuse", reason: "Version does not match the migrated original." };
  }
  if (!asset.destinationFileId || !asset.destinationPath || asset.privateVerified !== true) {
    return { action: "refuse", reason: "Migrated original is missing a private destination." };
  }
  const storedId = input.reference.imageKitFileId ?? null;
  const storedPath = input.reference.imageKitFilePath ?? null;
  if (storedId || storedPath) {
    if (storedId === asset.destinationFileId && storedPath === asset.destinationPath) {
      return { action: "unchanged", fileId: asset.destinationFileId, filePath: asset.destinationPath };
    }
    return { action: "refuse", reason: "Stored ImageKit identity does not match the migrated original." };
  }
  return {
    action: "write",
    fileId: asset.destinationFileId,
    filePath: asset.destinationPath,
    kind,
  };
}

const PREVIEW_DATABASE_PROJECT = "syneonzucehwlghqmfbg";
const PRODUCTION_DATABASE_PROJECT = "snlqivvogfqesxpbjiei";

function databaseHost(databaseUrl: string) {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return "";
  }
}

export function assertIsolatedLocalDatabase(databaseUrl: string) {
  const host = databaseHost(databaseUrl);
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("Backfill requires the isolated local database.");
  }
}

export function assertImageKitBackfillDatabase(
  databaseUrl: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const host = databaseHost(databaseUrl);
  if (host === "127.0.0.1" || host === "localhost") return;
  if (
    databaseUrl.includes(PREVIEW_DATABASE_PROJECT) &&
    env.IMAGEKIT_PREVIEW_BACKFILL_PROJECT === PREVIEW_DATABASE_PROJECT
  ) {
    return;
  }
  if (databaseUrl.includes(PRODUCTION_DATABASE_PROJECT)) {
    throw new Error("Backfill refused for the production database.");
  }
  throw new Error("Backfill requires the isolated local database or the explicitly confirmed preview project.");
}

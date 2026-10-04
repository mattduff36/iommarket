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

const SHARED_DATABASE_MARKERS = ["syneonzucehwlghqmfbg", "snlqivvogfqesxpbjiei"] as const;

export function assertIsolatedLocalDatabase(databaseUrl: string) {
  let host = "";
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    host = "";
  }
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("Backfill requires the isolated local database.");
  }
  if (SHARED_DATABASE_MARKERS.some((marker) => databaseUrl.includes(marker))) {
    throw new Error("Backfill refused for a shared database.");
  }
}

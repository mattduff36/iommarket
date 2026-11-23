import { createHash } from "node:crypto";
import type { PlanAction, SyncIdentity, SyncListing } from "./types";

export interface FingerprintDealer {
  id: string;
  userId: string;
  regionId: string | null;
  tier: string;
  isAdminPreview: boolean;
  role: string;
  disabledAt: string | null;
  deletedAt: string | null;
}

export interface FingerprintBinding {
  id: string;
  registryKey: string;
  enabled: boolean;
  verifiedAt: string | null;
}

export interface FingerprintSnapshot {
  dealer: FingerprintDealer;
  binding: FingerprintBinding;
  activeListingCount: number;
  listingCap: number;
  listings: SyncListing[];
  identities: SyncIdentity[];
  actions: PlanAction[];
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    // Prisma stores JSON object members with undefined values as absent.
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sortedBy<T>(items: T[], key: (item: T) => string) {
  return [...items].sort((left, right) => key(left).localeCompare(key(right)));
}

function snapshotDigest(snapshot: FingerprintSnapshot, legacyCondition: boolean) {
  const canonical = {
    ...snapshot,
    listings: sortedBy(snapshot.listings, (item) => item.id),
    identities: sortedBy(snapshot.identities, (item) => item.sourceIdentityKey),
    actions: sortedBy(
      snapshot.actions,
      (item) => `${item.kind}:${item.sourceIdentityKey ?? ""}:${item.listingId ?? ""}`,
    ).map(action => legacyCondition && action.review && action.review.condition === undefined
      ? { ...action, review: { ...action.review, condition: null } }
      : action),
  };
  return createHash("sha256").update(stableStringify(canonical)).digest("hex");
}

export function fingerprintSnapshot(snapshot: FingerprintSnapshot) {
  return snapshotDigest(snapshot, false);
}

export function matchesStockFingerprint(snapshot: FingerprintSnapshot, saved: string) {
  if (fingerprintSnapshot(snapshot) === saved) return true;
  // Older live reports hashed the scanner's explicit undefined condition as null.
  // Reconstruct that representation and compare the entire current snapshot.
  return snapshot.actions.some(action => action.review && action.review.condition === undefined) &&
    snapshotDigest(snapshot, true) === saved;
}

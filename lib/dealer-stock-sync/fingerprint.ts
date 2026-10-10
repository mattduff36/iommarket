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
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sortedBy<T>(items: T[], key: (item: T) => string) {
  return [...items].sort((left, right) => key(left).localeCompare(key(right)));
}

export function fingerprintSnapshot(snapshot: FingerprintSnapshot) {
  const canonical = {
    ...snapshot,
    listings: sortedBy(snapshot.listings, (item) => item.id),
    identities: sortedBy(snapshot.identities, (item) => item.sourceIdentityKey),
    actions: sortedBy(
      snapshot.actions,
      (item) => `${item.kind}:${item.sourceIdentityKey ?? ""}:${item.listingId ?? ""}`,
    ),
  };
  return createHash("sha256").update(stableStringify(canonical)).digest("hex");
}

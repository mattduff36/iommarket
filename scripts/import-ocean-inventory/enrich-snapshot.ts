import { createHash } from "node:crypto";
import { PREVIEW_PROJECT_REF } from "./target";
import {
  ENRICH_SNAPSHOT_SCHEMA_VERSION,
  type EnrichSnapshot,
  type SnapshotListing,
} from "./enrich-types";

export class SnapshotIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotIntegrityError";
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function computeSnapshotDigest(snapshot: Omit<EnrichSnapshot, "digest"> | EnrichSnapshot) {
  const { digest: _digest, ...rest } = snapshot as EnrichSnapshot;
  return createHash("sha256").update(canonicalJson(rest)).digest("hex");
}

export function buildSnapshot(input: {
  runId: string;
  dealerId: string;
  createdAt: string;
  listings: SnapshotListing[];
}): EnrichSnapshot {
  const unsigned = {
    schemaVersion: ENRICH_SNAPSHOT_SCHEMA_VERSION,
    runId: input.runId,
    projectRef: PREVIEW_PROJECT_REF,
    dealerId: input.dealerId,
    createdAt: input.createdAt,
    listings: input.listings,
  };
  return {
    ...unsigned,
    digest: computeSnapshotDigest(unsigned),
  };
}

export function verifySnapshot(snapshot: EnrichSnapshot, expectedDealerId?: string) {
  if (snapshot.schemaVersion !== ENRICH_SNAPSHOT_SCHEMA_VERSION) {
    throw new SnapshotIntegrityError("Unsupported enrichment snapshot version.");
  }
  if (snapshot.projectRef !== PREVIEW_PROJECT_REF) {
    throw new SnapshotIntegrityError("Snapshot project ref is not the preview project.");
  }
  if (expectedDealerId && snapshot.dealerId !== expectedDealerId) {
    throw new SnapshotIntegrityError("Snapshot dealer does not match Ocean Motor Village.");
  }
  const expectedDigest = computeSnapshotDigest(snapshot);
  if (snapshot.digest !== expectedDigest) {
    throw new SnapshotIntegrityError("Snapshot digest mismatch.");
  }
}

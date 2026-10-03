import { addDecimalStrings } from "@/lib/costs/money";
import type { CursorAuditDto } from "@/lib/costs/dto";

type AuditSource = { metadata: unknown };

type AuditEvent = {
  identity: string;
  occurredAt: string;
  model: string;
  funding: "included" | "on-demand";
  projectId: string;
  attributionStatus: string;
  nominalUsd: string | null;
  reportedOnDemandUsd: string;
  clientUsd: string;
  unresolved: boolean;
  free: boolean;
  identityAmbiguous: boolean;
  sourceQuality: "complete" | "partial" | "unknown";
  displayStatus: string;
  rateCardStatus: string;
};

type AuditGroup = {
  day: string;
  model: string;
  funding: "included" | "on-demand";
  events: AuditEvent[];
};

const decimal = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/;
const digest = /^[a-f0-9]{64}$/;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validEvent(value: unknown): value is AuditEvent {
  if (!record(value)) return false;
  return (
    typeof value.identity === "string" && digest.test(value.identity) &&
    typeof value.occurredAt === "string" && Number.isFinite(Date.parse(value.occurredAt)) &&
    typeof value.model === "string" && value.model.length > 0 && value.model.length <= 120 &&
    (value.funding === "included" || value.funding === "on-demand") &&
    typeof value.projectId === "string" && value.projectId === "itrader" &&
    value.attributionStatus === "assigned" &&
    (value.nominalUsd === null || (typeof value.nominalUsd === "string" && decimal.test(value.nominalUsd))) &&
    typeof value.reportedOnDemandUsd === "string" && decimal.test(value.reportedOnDemandUsd) &&
    typeof value.clientUsd === "string" && decimal.test(value.clientUsd) &&
    typeof value.unresolved === "boolean" && typeof value.free === "boolean" &&
    typeof value.identityAmbiguous === "boolean" &&
    (value.sourceQuality === "complete" || value.sourceQuality === "partial" || value.sourceQuality === "unknown") &&
    typeof value.displayStatus === "string" && typeof value.rateCardStatus === "string"
  );
}

function sourceData(metadata: unknown): { eventIds: string[]; records: unknown[] } | null {
  if (!record(metadata) || !Array.isArray(metadata.eventIds) || !Array.isArray(metadata.records)) return null;
  if (!metadata.eventIds.every((id) => typeof id === "string" && digest.test(id))) return null;
  return { eventIds: metadata.eventIds as string[], records: metadata.records };
}

function eventFingerprint(event: AuditEvent): string {
  return JSON.stringify([
    event.occurredAt,
    event.model,
    event.funding,
    event.projectId,
    event.attributionStatus,
    event.nominalUsd,
    event.reportedOnDemandUsd,
    event.clientUsd,
    event.unresolved,
    event.free,
    event.identityAmbiguous,
    event.sourceQuality,
    event.displayStatus,
    event.rateCardStatus,
  ]);
}

/**
 * Reconstructs only events explicitly referenced by active ledger charges.
 * Provider account and conversation identifiers are deliberately discarded.
 */
export function buildCursorAudit(sources: readonly AuditSource[]): CursorAuditDto {
  const groups = new Map<string, AuditGroup>();
  let incomplete = false;
  let eligibleSourceCount = 0;
  const referenceCounts = new Map<string, number>();
  const candidates = new Map<string, AuditEvent>();
  const conflicted = new Set<string>();

  for (const source of sources) {
    const data = sourceData(source.metadata);
    if (!data) {
      incomplete = true;
      continue;
    }
    eligibleSourceCount += 1;
    const indexed = new Map<string, AuditEvent>();
    const localConflicts = new Set<string>();
    for (const raw of data.records) {
      if (!record(raw) || typeof raw.identity !== "string" || !digest.test(raw.identity)) continue;
      const identity = raw.identity;
      if (!validEvent(raw)) {
        localConflicts.add(identity);
        indexed.delete(identity);
        continue;
      }
      if (localConflicts.has(identity)) continue;
      const existing = indexed.get(identity);
      if (existing && eventFingerprint(existing) !== eventFingerprint(raw)) {
        localConflicts.add(identity);
        indexed.delete(identity);
      } else {
        indexed.set(identity, raw);
      }
    }
    for (const id of data.eventIds) {
      const referenceCount = (referenceCounts.get(id) ?? 0) + 1;
      referenceCounts.set(id, referenceCount);
      if (referenceCount > 1) incomplete = true;
      if (localConflicts.has(id)) {
        conflicted.add(id);
        candidates.delete(id);
        incomplete = true;
        continue;
      }
      const event = indexed.get(id);
      if (!event || event.unresolved || event.free || event.identityAmbiguous) {
        incomplete = true;
        continue;
      }
      const existing = candidates.get(id);
      if (existing && eventFingerprint(existing) !== eventFingerprint(event)) {
        conflicted.add(id);
        candidates.delete(id);
        incomplete = true;
        continue;
      }
      if (conflicted.has(id)) continue;
      candidates.set(id, event);
    }
  }

  for (const [id, event] of candidates) {
      if (conflicted.has(id)) continue;
      const day = new Date(event.occurredAt).toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00.000Z`))) {
        incomplete = true;
        continue;
      }
      const key = `${day}\u0000${event.model}\u0000${event.funding}`;
      const group = groups.get(key) ?? { day, model: event.model, funding: event.funding, events: [] };
      group.events.push(event);
      groups.set(key, group);
  }

  if (eligibleSourceCount === 0) {
    return {
      status: "unavailable",
      reason: "No active Cursor source lines contain a verifiable event breakdown.",
      currency: "USD",
      rows: [],
    };
  }

  const rows = [...groups.values()].map((group) => {
    const knownNominal = group.events.filter((event) => event.nominalUsd !== null);
    const estimatedCount = knownNominal.filter((event) => event.rateCardStatus === "calculated").length;
    const reportedCount = knownNominal.length - estimatedCount;
    const nominalMissingEvents = group.events.length - knownNominal.length;
    const qualities = group.events.map((event) => event.sourceQuality);
    const sourceQuality = qualities.includes("unknown") ? "unknown" : qualities.includes("partial") ? "partial" : "complete";
    return {
      day: group.day,
      model: group.model,
      funding: group.funding,
      eventCount: group.events.length,
      nominalUsd: addDecimalStrings(group.events.map((event) => event.nominalUsd ?? "0")),
      nominalBasis: knownNominal.length === 0
        ? "unavailable"
        : estimatedCount === 0 && nominalMissingEvents === 0
          ? "provider-reported"
          : reportedCount === 0 && nominalMissingEvents === 0
            ? "rate-card-estimate"
            : "mixed",
      nominalMissingEvents,
      providerChargeUsd: addDecimalStrings(group.events.map((event) => event.reportedOnDemandUsd)),
      clientUsd: addDecimalStrings(group.events.map((event) => event.clientUsd)),
      sourceQuality,
      displayDiverged: group.events.some((event) => event.displayStatus === "diverged"),
    } as const;
  }).sort((a, b) => a.day.localeCompare(b.day) || a.model.localeCompare(b.model) || a.funding.localeCompare(b.funding));

  return {
    status: incomplete ? "partial" : "available",
    reason: incomplete ? "Some active Cursor source lines or events could not be reconciled; displayed rows include only verified events." : null,
    currency: "USD",
    rows,
  };
}

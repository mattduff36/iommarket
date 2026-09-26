import { createHash } from "node:crypto";
import { addDecimalStrings, parseDecimalString, quantizeDecimal } from "@/lib/costs/money";
import {
  displayReconciles,
  normalizeProviderUsd,
  parseDisplayUsd,
} from "@/lib/costs/cursor-decimal";
import {
  CURSOR_CLIENT_POLICY_VERSION,
  CURSOR_INCLUDED_POOL_EXPECTATION_USD,
  ITRADER_PROJECT_ID,
  cursorClientUsd,
} from "@/lib/costs/cursor-policy";
import { nominalUsdFromTokens } from "@/lib/costs/cursor-rates";

export const INCLUDED_KIND = "USAGE_EVENT_KIND_INCLUDED_IN_ULTRA";
export const ON_DEMAND_KIND = "USAGE_EVENT_KIND_USAGE_BASED";

export type CursorFunding = "included" | "on-demand" | "unresolved";
export type CursorAttributionStatus = "assigned" | "unassigned" | "ambiguous";
export type CursorSourceQuality = "complete" | "partial" | "unknown";

export interface RawCursorUsageEvent {
  timestamp: string;
  model: string;
  kind?: string | null;
  conversationId?: string | null;
  isChargeable?: boolean | null;
  isTokenBasedCall?: boolean | null;
  chargedCents?: number | string | null;
  usageBasedCosts?: string | null;
  cursorTokenFee?: number | string | null;
  requestsCosts?: number | string | null;
  tokenUsage?: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    cacheReadTokens?: number | null;
    cacheWriteTokens?: number | null;
    totalCents?: number | string | null;
  } | null;
}

export interface NormalizedCursorEvent {
  identity: string;
  occurredAt: string;
  model: string;
  rawKind: string | null;
  funding: CursorFunding;
  conversationId: string | null;
  attributionStatus: CursorAttributionStatus;
  projectId: string | null;
  nominalUsd: string | null;
  reportedOnDemandUsd: string;
  clientUsd: string;
  free: boolean;
  unresolved: boolean;
  identityAmbiguous: boolean;
  rateCardStatus: string;
  displayStatus: string;
  sourceQuality: CursorSourceQuality;
}

export function fundingFromKind(kind: string | null | undefined): CursorFunding {
  if (kind === INCLUDED_KIND) return "included";
  if (kind === ON_DEMAND_KIND) return "on-demand";
  return "unresolved";
}

function tokenFingerprint(event: RawCursorUsageEvent): string {
  const usage = event.tokenUsage;
  return [
    usage?.inputTokens ?? "",
    usage?.outputTokens ?? "",
    usage?.cacheReadTokens ?? "",
    usage?.cacheWriteTokens ?? "",
  ].join(":");
}

function groupKey(accountRef: string, event: RawCursorUsageEvent): string {
  const tokenBased =
    event.isTokenBasedCall === true ? "1" : event.isTokenBasedCall === false ? "0" : "";
  return [
    accountRef,
    event.timestamp,
    event.model,
    event.conversationId ?? "",
    event.kind ?? "",
    tokenBased,
  ].join("|");
}

export function assessFetchCompleteness(input: {
  fetchedCount: number;
  reportedTotal: number | null;
  pageCapReached: boolean;
}): { quality: CursorSourceQuality; reason: string | null } {
  if (input.pageCapReached) {
    return { quality: "partial", reason: "The fetch hit its page cap." };
  }
  if (input.reportedTotal === null) {
    return { quality: "unknown", reason: "The provider did not report a total count." };
  }
  if (input.fetchedCount !== input.reportedTotal) {
    return { quality: "partial", reason: "Fetched events do not match the reported total." };
  }
  return { quality: "complete", reason: null };
}

function explicitZeroNonToken(event: RawCursorUsageEvent): boolean {
  const charged = event.chargedCents;
  const chargedZero = charged === 0 || charged === "0";
  return event.isTokenBasedCall === false && chargedZero && !event.tokenUsage;
}

export function normalizeCursorEvents(input: {
  providerAccountRef: string;
  events: RawCursorUsageEvent[];
  attribution: ReadonlyMap<string, { projectId: string | null; status: CursorAttributionStatus }>;
  sourceQuality: CursorSourceQuality;
}): NormalizedCursorEvent[] {
  const groups = new Map<string, Array<{ event: RawCursorUsageEvent; index: number }>>();
  input.events.forEach((event, index) => {
    const key = groupKey(input.providerAccountRef, event);
    const current = groups.get(key) ?? [];
    current.push({ event, index });
    groups.set(key, current);
  });

  const normalized: NormalizedCursorEvent[] = [];
  for (const [key, items] of groups) {
    const fingerprintCounts = new Map<string, number>();
    for (const item of items) {
      const fingerprint = tokenFingerprint(item.event);
      fingerprintCounts.set(fingerprint, (fingerprintCounts.get(fingerprint) ?? 0) + 1);
    }
    const ordered = [...items].sort((left, right) => {
      const fingerprint = tokenFingerprint(left.event).localeCompare(tokenFingerprint(right.event));
      return fingerprint === 0 ? left.index - right.index : fingerprint;
    });
    ordered.forEach((item, occurrence) => {
      normalized.push(
        normalizeOne({
          accountRef: input.providerAccountRef,
          groupKey: key,
          occurrence,
          event: item.event,
          ambiguous: (fingerprintCounts.get(tokenFingerprint(item.event)) ?? 0) > 1,
          attribution: input.attribution,
          sourceQuality: input.sourceQuality,
        }),
      );
    });
  }
  return normalized.sort((left, right) => left.identity.localeCompare(right.identity));
}

function normalizeOne(input: {
  accountRef: string;
  groupKey: string;
  occurrence: number;
  event: RawCursorUsageEvent;
  ambiguous: boolean;
  attribution: ReadonlyMap<string, { projectId: string | null; status: CursorAttributionStatus }>;
  sourceQuality: CursorSourceQuality;
}): NormalizedCursorEvent {
  const funding = fundingFromKind(input.event.kind);
  const free = explicitZeroNonToken(input.event);
  const tokenTotal = input.event.tokenUsage?.totalCents;
  const hasNominal = tokenTotal !== undefined && tokenTotal !== null && tokenTotal !== "";
  const nominalUsd = hasNominal ? normalizeProviderUsd(tokenTotal) : null;
  const chargedUsd =
    input.event.chargedCents === undefined || input.event.chargedCents === null
      ? null
      : normalizeProviderUsd(input.event.chargedCents);
  const display = input.event.usageBasedCosts
    ? parseDisplayUsd(input.event.usageBasedCosts)
    : null;
  const rate = input.event.tokenUsage
    ? nominalUsdFromTokens({
        model: input.event.model,
        inputTokens: input.event.tokenUsage.inputTokens ?? 0,
        outputTokens: input.event.tokenUsage.outputTokens ?? 0,
        cacheReadTokens: input.event.tokenUsage.cacheReadTokens ?? 0,
        cacheWriteTokens: input.event.tokenUsage.cacheWriteTokens ?? 0,
      })
    : { usd: null, status: "not-token-based" };
  const rateCardStatus =
    nominalUsd && rate.usd
      ? quantizeDecimal(nominalUsd, 6) === quantizeDecimal(rate.usd, 6)
        ? "matched"
        : `${rate.status}:diverged`
      : rate.status;

  let reportedOnDemandUsd = "0";
  let unresolved = funding === "unresolved";
  if (free) {
    reportedOnDemandUsd = "0";
  } else if (funding === "on-demand") {
    if (!chargedUsd) unresolved = true;
    else reportedOnDemandUsd = chargedUsd;
  } else if (funding === "included" && !nominalUsd && !free) {
    unresolved = !rate.usd;
  }

  const includedBasis = funding === "included" && !free ? nominalUsd ?? rate.usd ?? "0" : "0";
  if (funding === "included" && !free && includedBasis === "0" && !nominalUsd && !rate.usd) {
    unresolved = true;
  }
  const clientUsd = unresolved || free
    ? "0"
    : cursorClientUsd({
        includedNominalUsd: includedBasis,
        onDemandUsd: reportedOnDemandUsd,
      });
  const attribution = input.event.conversationId
    ? input.attribution.get(input.event.conversationId)
    : undefined;

  return {
    identity: createHash("sha256")
      .update(`${input.groupKey}|${input.occurrence}`)
      .digest("hex"),
    occurredAt: input.event.timestamp,
    model: input.event.model,
    rawKind: input.event.kind ?? null,
    funding,
    conversationId: input.event.conversationId ?? null,
    attributionStatus: attribution?.status ?? "unassigned",
    projectId: attribution?.status === "assigned" ? attribution.projectId : null,
    nominalUsd: funding === "included" ? nominalUsd ?? rate.usd : nominalUsd,
    reportedOnDemandUsd,
    clientUsd,
    free,
    unresolved,
    identityAmbiguous: input.ambiguous,
    rateCardStatus,
    displayStatus: displayReconciles(chargedUsd ?? "0", display),
    sourceQuality: input.sourceQuality,
  };
}

export interface CursorLedgerLine {
  bucketKey: string;
  checksum: string;
  periodStart: Date;
  periodEnd: Date;
  nativeAmount: string;
  includedNominalUsd: string;
  onDemandUsd: string;
  funding: "included" | "on-demand";
  eventIds: string[];
  displayLabel: string;
  invoiceability: "INVOICEABLE" | "PROVISIONAL";
}

export function planCursorClientLines(
  events: readonly NormalizedCursorEvent[],
): CursorLedgerLine[] {
  const groups = new Map<string, NormalizedCursorEvent[]>();
  for (const event of events) {
    if (event.unresolved || event.free || event.identityAmbiguous) continue;
    if (event.funding !== "included" && event.funding !== "on-demand") continue;
    if (event.attributionStatus !== "assigned" || event.projectId !== ITRADER_PROJECT_ID) continue;
    if (event.clientUsd === "0" || event.clientUsd === "0.00000000") continue;
    const day = event.occurredAt.slice(0, 10);
    const key = `${day}:${event.funding}`;
    const current = groups.get(key) ?? [];
    current.push(event);
    groups.set(key, current);
  }

  return [...groups.entries()].map(([key, group]) => {
    const [day, funding] = key.split(":") as [string, "included" | "on-demand"];
    const includedNominalUsd = addDecimalStrings(
      group.map((event) => (funding === "included" ? event.nominalUsd ?? "0" : "0")),
    );
    const onDemandUsd = addDecimalStrings(group.map((event) => event.reportedOnDemandUsd));
    const clientUsd = cursorClientUsd({
      includedNominalUsd: funding === "included" ? includedNominalUsd : "0",
      onDemandUsd: funding === "on-demand" ? onDemandUsd : "0",
    });
    const eventIds = group.map((event) => event.identity).sort();
    const periodStart = new Date(`${day}T00:00:00.000Z`);
    const partial = group.some(
      (event) => event.sourceQuality !== "complete" || event.displayStatus === "diverged",
    );
    return {
      bucketKey: `cursor:${ITRADER_PROJECT_ID}:${funding}:${day}:${CURSOR_CLIENT_POLICY_VERSION}`,
      checksum: createHash("sha256")
        .update([CURSOR_CLIENT_POLICY_VERSION, funding, clientUsd, eventIds.join(",")].join("|"))
        .digest("hex"),
      periodStart,
      periodEnd: new Date(periodStart.getTime() + 86_400_000),
      nativeAmount: quantizeDecimal(clientUsd, 8),
      includedNominalUsd,
      onDemandUsd,
      funding,
      eventIds,
      displayLabel: `Cursor ${day} ${funding}`,
      invoiceability: partial ? "PROVISIONAL" : "INVOICEABLE",
    };
  });
}

export function mergeCursorEvents(
  previous: readonly NormalizedCursorEvent[],
  incoming: readonly NormalizedCursorEvent[],
  quality: CursorSourceQuality,
): NormalizedCursorEvent[] {
  // Completeness describes the provider fetch, not this upload batch. Outbox
  // batches are additive and corrections replace matching event identities.
  void quality;
  const merged = new Map(previous.map((event) => [event.identity, event]));
  for (const event of incoming) merged.set(event.identity, event);
  return [...merged.values()];
}

export function assessCursorAllowance(input: {
  accountNominalUsd: string;
  accountOnDemandUsd: string;
  reportedAllowanceUsd?: string | null;
  remainingUsd?: string | null;
  expectationUsd?: string;
}): {
  expectationUsd: string;
  expectationCrossed: boolean;
  confirmedOnDemand: boolean;
  alert: "none" | "80" | "90" | "confirmed-on-demand";
} {
  const expectation = input.expectationUsd ?? CURSOR_INCLUDED_POOL_EXPECTATION_USD;
  const expectationCrossed = decimalAtLeast(input.accountNominalUsd, expectation);
  const remaining = input.remainingUsd === undefined || input.remainingUsd === null
    ? null
    : Number(input.remainingUsd);
  const allowance = input.reportedAllowanceUsd === undefined || input.reportedAllowanceUsd === null
    ? null
    : Number(input.reportedAllowanceUsd);
  const confirmedOnDemand = decimalAtLeast(input.accountOnDemandUsd, "0.00000001");
  let alert: "none" | "80" | "90" | "confirmed-on-demand" = "none";
  if (confirmedOnDemand && Number(input.accountOnDemandUsd) > 0) alert = "confirmed-on-demand";
  else if (allowance && remaining !== null && allowance > 0) {
    const used = 1 - remaining / allowance;
    if (used >= 0.9) alert = "90";
    else if (used >= 0.8) alert = "80";
  }
  return { expectationUsd: expectation, expectationCrossed, confirmedOnDemand, alert };
}

function decimalAtLeast(left: string, right: string): boolean {
  const a = parseDecimalString(left);
  const b = parseDecimalString(right);
  const scale = Math.max(a.scale, b.scale);
  const leftUnscaled = a.unscaled * BigInt(10) ** BigInt(scale - a.scale);
  const rightUnscaled = b.unscaled * BigInt(10) ** BigInt(scale - b.scale);
  return leftUnscaled >= rightUnscaled;
}

export function interpretCursorCsvCost(input: { kind: string; cost: string }): {
  funding: CursorFunding;
  free: boolean;
  onDemandUsd: string | null;
  nominalInCostCell: boolean;
} {
  const kind = input.kind.trim().toLowerCase();
  const cost = input.cost.trim();
  const funding: CursorFunding =
    kind === "included" ? "included" : kind === "on-demand" ? "on-demand" : "unresolved";
  if (/^free$/i.test(cost)) {
    return { funding, free: true, onDemandUsd: null, nominalInCostCell: false };
  }
  if (/^included$/i.test(cost)) {
    return { funding: "included", free: false, onDemandUsd: null, nominalInCostCell: false };
  }
  const numeric = parseDisplayUsd(cost);
  if (funding === "on-demand" && numeric) {
    return { funding, free: false, onDemandUsd: numeric, nominalInCostCell: false };
  }
  return { funding, free: false, onDemandUsd: null, nominalInCostCell: false };
}

import { Prisma } from "@prisma/client";
import { cursorIngestSchema, type CursorIngestBody } from "@/lib/costs/cursor-contract";
import {
  mergeCursorEvents,
  normalizeCursorEvents,
  planCursorClientLines,
  assessCursorAllowance,
  type NormalizedCursorEvent,
} from "@/lib/costs/cursor-events";
import { CURSOR_CLIENT_POLICY_VERSION, cursorClientGbpMinor } from "@/lib/costs/cursor-policy";
import { costDb } from "@/lib/costs/db";
import { getOrCreateUsdGbpRate } from "@/lib/costs/fx";
import { applyClassifiedCharge, ensureLedgerConfig } from "@/lib/costs/ledger";
import { assertCanonicalLedgerWriter } from "@/lib/costs/ledger-role";
import { runSerializable } from "@/lib/costs/transaction";

export interface CursorIngestResult {
  status: "succeeded" | "duplicate" | "processing";
  runId: string;
  classifiedCount: number;
  unresolvedCount: number;
  eventStore: "table";
}

export class CursorIngestConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CursorIngestConflictError";
  }
}

async function previousEvents(bucketKey: string): Promise<NormalizedCursorEvent[]> {
  const snapshot = await costDb.costSourceSnapshot.findFirst({
    where: { sourceKind: "CURSOR_USAGE", bucketKey, classified: true, quarantined: false },
    orderBy: { revision: "desc" },
    select: { metadata: true },
  });
  const metadata = snapshot?.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const records = (metadata as { records?: NormalizedCursorEvent[] }).records;
  return Array.isArray(records) ? records : [];
}

async function assertNoLegacyCursorOverlap(days: readonly string[]) {
  const snapshots = await costDb.costSourceSnapshot.findMany({
    where: {
      sourceKind: "CURSOR_USAGE",
      bucketKey: {
        in: [...new Set(days)].map((day) => `cursor:subscription:${day}`),
      },
      classified: true,
      quarantined: false,
    },
    include: {
      entries: {
        where: { kind: "CHARGE" },
        include: { reversedBy: { select: { id: true } } },
      },
    },
  });
  const unreversedDays = snapshots
    .filter((snapshot) =>
      snapshot.entries.some((entry) => entry.reversedBy.length === 0),
    )
    .map((snapshot) => snapshot.bucketKey.replace("cursor:subscription:", ""));
  if (unreversedDays.length > 0) {
    throw new CursorIngestConflictError(
      `Legacy Cursor subscription-share lines must be reconciled before ingesting: ${[
        ...new Set(unreversedDays),
      ].sort().join(", ")}.`,
    );
  }
}

export async function ingestCursorBatch(input: {
  body: CursorIngestBody;
  idempotencyKey: string;
  env?: NodeJS.ProcessEnv;
}): Promise<CursorIngestResult> {
  const env = input.env ?? process.env;
  assertCanonicalLedgerWriter(env);
  const body = cursorIngestSchema.parse(input.body);
  const batchId = `cursor-ingest:${input.idempotencyKey}`;
  const existing = await costDb.costIngestBatch.findUnique({
    where: { id: batchId },
  });
  const recentRunning =
    existing?.status === "RUNNING" &&
    Date.now() - existing.startedAt.getTime() < 15 * 60 * 1000;
  if (existing?.status === "SUCCEEDED") {
    return {
      status: "duplicate",
      runId: existing.id,
      classifiedCount: existing.classifiedCount,
      unresolvedCount: existing.unresolvedCount,
      eventStore: "table",
    };
  }
  if (recentRunning) {
    return {
      status: "processing",
      runId: existing.id,
      classifiedCount: existing.classifiedCount,
      unresolvedCount: existing.unresolvedCount,
      eventStore: "table",
    };
  }

  const timestamps = body.events.map((event) => new Date(event.timestamp).getTime());
  const queryFrom = timestamps.length
    ? new Date(Math.min(...timestamps))
    : new Date();
  const queryTo = timestamps.length
    ? new Date(Math.max(...timestamps) + 1)
    : queryFrom;
  let ownsRun = true;
  const run = existing
    ? await costDb.costIngestBatch.update({
        where: { id: existing.id },
        data: {
          status: "RUNNING",
          queryFrom,
          queryTo,
          classifiedCount: 0,
          unresolvedCount: 0,
          errorCode: null,
          completedAt: null,
        },
      })
    : await costDb.costIngestBatch.create({
        data: {
          id: batchId,
          providerAccountRef: body.providerAccountRef,
          status: "RUNNING",
          queryFrom,
          queryTo,
        },
      }).catch(async (error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const raced = await costDb.costIngestBatch.findUnique({
            where: { id: batchId },
          });
          if (raced) {
            ownsRun = false;
            return raced;
          }
        }
        throw error;
      });

  if (!ownsRun) {
    return {
      status: run.status === "SUCCEEDED" ? "duplicate" : "processing",
      runId: run.id,
      classifiedCount: run.classifiedCount,
      unresolvedCount: run.unresolvedCount,
      eventStore: "table",
    };
  }

  try {
  const attribution = new Map(
    body.events
      .filter((event) => event.conversationId)
      .map((event) => [
        event.conversationId as string,
        { projectId: event.attribution.projectId, status: event.attribution.status },
      ]),
  );
  const normalized = normalizeCursorEvents({
    providerAccountRef: body.providerAccountRef,
    events: body.events,
    attribution,
    sourceQuality: body.sourceQuality,
  });
  const merged: NormalizedCursorEvent[] = [];
  const byDay = new Map<string, NormalizedCursorEvent[]>();
  for (const event of normalized) {
    const day = event.occurredAt.slice(0, 10);
    const current = byDay.get(day) ?? [];
    current.push(event);
    byDay.set(day, current);
  }
  for (const [day, events] of byDay) {
    const bucketKeys = ["included", "on-demand"].map(
      (funding) => `cursor:itrader:${funding}:${day}:${CURSOR_CLIENT_POLICY_VERSION}`,
    );
    const prior = (
      await Promise.all(bucketKeys.map((bucketKey) => previousEvents(bucketKey)))
    ).flat();
    merged.push(...mergeCursorEvents(prior, events, body.sourceQuality));
  }

  const lines = planCursorClientLines(merged);
  await assertNoLegacyCursorOverlap(
    lines.map((line) => line.periodStart.toISOString().slice(0, 10)),
  );
  const config = await runSerializable((tx) => ensureLedgerConfig(tx));
  let classifiedCount = 0;
  for (const line of lines) {
    await runSerializable(async (tx) => {
      const fx = await getOrCreateUsdGbpRate(tx, line.periodStart);
      const records = merged.filter(
        (event) =>
          event.occurredAt.slice(0, 10) === line.periodStart.toISOString().slice(0, 10) &&
          event.funding === line.funding,
      );
      const result = await applyClassifiedCharge(tx, {
        sourceKind: "CURSOR_USAGE",
        bucketKey: line.bucketKey,
        checksum: line.checksum,
        category: "CURSOR",
        invoiceability: line.invoiceability,
        nativeAmount: line.nativeAmount,
        nativeCurrency: "USD",
        rate: fx.rate,
        fxRateSnapshotId: fx.id,
        periodStart: line.periodStart,
        periodEnd: line.periodEnd,
        displayLabel: line.displayLabel,
        startedAt: config.startedAt,
        markedGbpMinor: cursorClientGbpMinor(line.nativeAmount, fx.rate),
        metadata: JSON.parse(JSON.stringify({
          policyVersion: CURSOR_CLIENT_POLICY_VERSION,
          exemptFromInfrastructureMarkup: true,
          includedNominalUsd: line.includedNominalUsd,
          onDemandUsd: line.onDemandUsd,
          eventIds: line.eventIds,
          records,
        })) as Prisma.InputJsonValue,
      });
      if (result !== "skipped") classifiedCount += 1;
    });
  }

  for (const event of merged) {
    if (event.projectId !== "itrader") continue;
    await costDb.costUsageEvent.upsert({
        where: { id: event.identity },
        create: {
          id: event.identity,
          providerAccountRef: body.providerAccountRef,
          projectId: event.projectId,
          attributionStatus: event.attributionStatus,
          occurredAt: new Date(event.occurredAt),
          fundingStatus: event.funding,
          model: event.model,
          nominalUsd: event.nominalUsd,
          providerChargeUsd: event.reportedOnDemandUsd,
          clientUsd: event.clientUsd,
          policyVersion: CURSOR_CLIENT_POLICY_VERSION,
          sourceQuality: event.sourceQuality,
          rawKind: event.rawKind,
          checksum: event.identity,
        },
        update: {
          nominalUsd: event.nominalUsd,
          providerChargeUsd: event.reportedOnDemandUsd,
          clientUsd: event.clientUsd,
          sourceQuality: event.sourceQuality,
        },
    });
  }
  if (body.allowance) {
    const assessment = assessCursorAllowance({
        accountNominalUsd: body.allowance.accountNominalUsd,
        accountOnDemandUsd: body.allowance.accountOnDemandUsd,
        reportedAllowanceUsd: body.allowance.reportedAllowanceUsd,
        remainingUsd: body.allowance.remainingUsd,
      });
    await costDb.costAllowanceObservation.create({
        data: {
          providerAccountRef: body.providerAccountRef,
          observedAt: new Date(body.allowance.observedAt),
          cycleStart: body.allowance.cycleStart ? new Date(body.allowance.cycleStart) : null,
          cycleEnd: body.allowance.cycleEnd ? new Date(body.allowance.cycleEnd) : null,
          poolLabel: body.allowance.poolLabel,
          reportedAllowanceUsd: body.allowance.reportedAllowanceUsd,
          remainingUsd: body.allowance.remainingUsd,
          accountNominalUsd: body.allowance.accountNominalUsd,
          accountOnDemandUsd: body.allowance.accountOnDemandUsd,
          quality: body.allowance.quality,
          expectationUsd: assessment.expectationUsd,
          expectationCrossed: assessment.expectationCrossed,
          confirmedOnDemand: assessment.confirmedOnDemand,
        },
    });
  }

  const unresolvedCount = normalized.filter((event) => event.unresolved).length;
  await costDb.costIngestBatch.update({
    where: { id: run.id },
    data: {
      status: "SUCCEEDED",
      classifiedCount,
      unresolvedCount,
      completedAt: new Date(),
      errorCode: null,
    },
  });

  return {
    status: "succeeded" as const,
    runId: run.id,
    classifiedCount,
    unresolvedCount,
    eventStore: "table",
  };
  } catch (error) {
    await costDb.costIngestBatch.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        errorCode:
          error instanceof Prisma.PrismaClientKnownRequestError
            ? error.code
            : error instanceof Error
              ? error.name
              : "CURSOR_INGEST_FAILED",
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

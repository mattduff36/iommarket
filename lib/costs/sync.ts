import { createHash } from "node:crypto";
import { Prisma, type CostSyncTrigger } from "@prisma/client";
import {
  getVercelBillingConfig,
  isCostsEnabled,
} from "@/lib/costs/config";
import {
  aggregateClassifiedCharges,
  classifyFocusRows,
  sharedMembershipChecksum,
} from "@/lib/costs/classify";
import { isOnOrAfterLaunch } from "@/lib/costs/dates";
import { getOrCreateUsdGbpRate } from "@/lib/costs/fx";
import { focusCoversMarketplaceLine } from "@/lib/costs/marketplace-import";
import { nextInfrastructureSlice } from "@/lib/costs/sync-window";
import {
  applyClassifiedCharge,
  ensureLedgerConfig,
  listLatestBucketRevisions,
  recordQuarantine,
} from "@/lib/costs/ledger";
import { planLedgerRevision } from "@/lib/costs/ledger-plan";
import { renewCostSyncLock, withCostSyncLock } from "@/lib/costs/lock";
import { allocateSharedPence } from "@/lib/costs/shared";
import { computeMarkedGbpMinor } from "@/lib/costs/money";
import { runSerializable } from "@/lib/costs/transaction";
import {
  CostProviderUnavailableError,
  fetchFocusCharges,
  listActiveProductionProjectIdsByPeriod,
} from "@/lib/costs/vercel";
import { costDb } from "@/lib/costs/db";

export const MAX_COST_WRITES_PER_RUN = 75;
const STALE_SYNC_RUN_MS = 15 * 60 * 1000;
export const COST_SYNC_CONTINUE_CODE = "COST_SYNC_CONTINUE";
export const COST_SYNC_STALE_CODE = "COST_SYNC_STALE";

export interface CostSyncResult {
  status: "skipped" | "locked" | "partial" | "succeeded" | "failed";
  runId?: string;
  classifiedCount?: number;
  quarantinedCount?: number;
  errorCode?: string;
  caughtUp?: boolean;
  queryFrom?: string;
  queryTo?: string;
}

export function takeCostSyncWork<T>(
  items: readonly T[],
  limit = MAX_COST_WRITES_PER_RUN,
): { items: T[]; hasMore: boolean } {
  const boundedLimit = Math.max(1, Math.floor(limit));
  return {
    items: items.slice(0, boundedLimit),
    hasMore: items.length > boundedLimit,
  };
}

export async function recoverStaleCostSyncRuns(now = new Date()): Promise<number> {
  const result = await costDb.costSyncRun.updateMany({
    where: {
      status: "RUNNING",
      startedAt: { lt: new Date(now.getTime() - STALE_SYNC_RUN_MS) },
    },
    data: {
      status: "FAILED",
      errorCode: COST_SYNC_STALE_CODE,
      completedAt: now,
    },
  });
  return result.count;
}

export function classifyCostSyncFailure(error: unknown): string {
  if (error instanceof CostProviderUnavailableError) return error.code;
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return "COST_SYNC_TIMEOUT";
  }
  if (error instanceof Error && /timeout/i.test(error.message)) return "COST_SYNC_TIMEOUT";
  if (error instanceof Error && error.name) return error.name;
  return "COST_SYNC_FAILED";
}

export async function runCostSync(input: {
  trigger: CostSyncTrigger;
  eventId?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<CostSyncResult> {
  const env = input.env ?? process.env;
  if (!isCostsEnabled(env)) {
    return { status: "skipped" };
  }

  if (input.eventId) {
    const existing = await costDb.costSyncRun.findUnique({
      where: { eventId: input.eventId },
    });
    if (existing?.status === "SUCCEEDED") {
      return {
        status: "succeeded",
        runId: existing.id,
        classifiedCount: existing.classifiedCount,
        quarantinedCount: existing.quarantinedCount,
      };
    }
    if (
      existing?.status === "RUNNING" &&
      Date.now() - existing.startedAt.getTime() < 15 * 60 * 1000
    ) {
      return { status: "locked", runId: existing.id };
    }
  }

  const locked = await withCostSyncLock(async (holder) => {
    await recoverStaleCostSyncRuns();
    return executeCostSync(input, holder);
  });

  if (!locked.acquired) {
    return { status: "locked" };
  }
  return locked.result;
}

async function executeCostSync(
  input: {
    trigger: CostSyncTrigger;
    eventId?: string;
    env?: NodeJS.ProcessEnv;
  },
  lockHolder: string,
): Promise<CostSyncResult> {
  const env = input.env ?? process.env;
  const now = new Date();
  const config = await runSerializable((tx) => ensureLedgerConfig(tx));
  if (now < config.startedAt) {
    return { status: "skipped" };
  }

  const lastSuccess = await costDb.costSyncRun.findFirst({
    where: { status: "SUCCEEDED" },
    orderBy: { queryTo: "desc" },
  });
  const window = nextInfrastructureSlice({
    startedAt: config.startedAt,
    now,
    lastSuccessfulTo: lastSuccess?.queryTo ?? null,
  });
  const existingRun = input.eventId
    ? await costDb.costSyncRun.findUnique({ where: { eventId: input.eventId } })
    : null;
  const run = existingRun
    ? await costDb.costSyncRun.update({
        where: { id: existingRun.id },
        data: {
          trigger: input.trigger,
          status: "RUNNING",
          queryFrom: window.from,
          queryTo: window.to,
          errorCode: null,
          completedAt: null,
        },
      })
    : await costDb.costSyncRun.create({
        data: {
          trigger: input.trigger,
          status: "RUNNING",
          eventId: input.eventId,
          queryFrom: window.from,
          queryTo: window.to,
        },
      });

  let classifiedCount = 0;

  try {
    const billing = getVercelBillingConfig(env);
    const charges = await fetchFocusCharges({
      from: window.from,
      to: window.to,
      env,
    });
    const classified = classifyFocusRows(charges.rows, {
      projectId: billing.projectId,
      projectIds: billing.projectIds,
      previewProjectId: billing.previewProjectId,
      databaseResourceIds: billing.databaseResourceIds,
      now,
      untaggedPolicy: env.COST_FOCUS_UNTAGGED_POLICY === "unresolved" ? "unresolved" : "shared",
    });

    let quarantinedCount = charges.quarantined.length + classified.quarantined.length;

    const ledgerCharges = aggregateClassifiedCharges(classified.classified).filter(
      (charge) => isOnOrAfterLaunch(charge.periodStart, config.startedAt),
    );
    const sharedPeriods = [
      ...new Map(
        ledgerCharges
          .filter((charge) => charge.kind === "shared")
          .map((charge) => {
            const key = `${charge.periodStart.toISOString()}:${charge.periodEnd.toISOString()}`;
            return [key, { key, to: charge.periodEnd }] as const;
          }),
      ).values(),
    ];
    const [sharedMembershipByPeriod, existingRevisions, manualDatabase] = await Promise.all([
      listActiveProductionProjectIdsByPeriod({
        periods: sharedPeriods,
        env,
      }),
      listLatestBucketRevisions(
        costDb,
        "VERCEL_FOCUS",
        ledgerCharges.map((charge) => charge.bucketKey),
      ),
      costDb.costEntry.findMany({
        where: { category: "DATABASE", sourceKind: "MANUAL", kind: "CHARGE" },
        select: {
          nativeAmount: true,
          servicePeriodStart: true,
          servicePeriodEnd: true,
          displayLabel: true,
        },
      }),
    ]);

    const pendingWrites: Array<{
      charge: (typeof ledgerCharges)[number];
      checksum: string;
      invoiceability: NonNullable<(typeof ledgerCharges)[number]["invoiceability"]>;
      sharedAllocation: ReturnType<typeof allocateSharedPence> | null;
    }> = [];

    for (const charge of ledgerCharges) {
      if (
        charge.kind === "database" &&
        manualDatabase.some((manual) =>
          focusCoversMarketplaceLine(
            {
              invoiceId: "recorded",
              lineId: "recorded",
              nativeAmount: manual.nativeAmount.toString(),
              nativeCurrency: "USD",
              periodStart: manual.servicePeriodStart,
              periodEnd: manual.servicePeriodEnd,
              serviceName: manual.displayLabel,
            },
            [
              {
                nativeAmount: charge.nativeAmount,
                periodStart: charge.periodStart,
                periodEnd: charge.periodEnd,
                serviceName: charge.displayLabel,
              },
            ],
          ),
        )
      ) {
        quarantinedCount += 1;
        continue;
      }
      let checksum = charge.checksum;
      let sharedAllocation: ReturnType<typeof allocateSharedPence> | null = null;
      if (charge.kind === "shared") {
        const membershipKey = `${charge.periodStart.toISOString()}:${charge.periodEnd.toISOString()}`;
        const membership = sharedMembershipByPeriod.get(membershipKey) ?? [];
        sharedAllocation = allocateSharedPence(
          BigInt(0),
          membership,
          billing.projectId,
        );
        if (sharedAllocation.denominator === 0) {
          await runSerializable((tx) =>
            recordQuarantine(tx, {
              sourceKind: "VERCEL_FOCUS",
              bucketKey: `${charge.bucketKey}:unallocated`,
              checksum: charge.checksum,
              periodStart: charge.periodStart,
              periodEnd: charge.periodEnd,
              reason: "Shared charge could not be allocated to an active project.",
            }),
          );
          quarantinedCount += 1;
          continue;
        }
        checksum = sharedMembershipChecksum(
          charge.checksum,
          sharedAllocation.membership,
          charge.invoiceability ?? "PROVISIONAL",
        );
      }

      const invoiceability = charge.invoiceability ?? "INVOICEABLE";
      const plan = planLedgerRevision(existingRevisions.get(charge.bucketKey) ?? null, {
        checksum,
        invoiceability,
      });
      if (plan.type === "skip") continue;
      pendingWrites.push({ charge, checksum, invoiceability, sharedAllocation });
    }
    const work = takeCostSyncWork(pendingWrites);

    const fxByPeriod = new Map<string, Awaited<ReturnType<typeof getOrCreateUsdGbpRate>>>();
    for (const item of work.items) {
      const periodKey = item.charge.periodStart.toISOString();
      if (!fxByPeriod.has(periodKey)) {
        fxByPeriod.set(
          periodKey,
          await getOrCreateUsdGbpRate(costDb, item.charge.periodStart),
        );
      }
    }

    for (let index = 0; index < work.items.length; index += 15) {
      const batch = work.items.slice(index, index + 15);
      if (!await renewCostSyncLock(lockHolder)) {
        throw new Error("Cost sync lock was lost.");
      }
      await runSerializable(async (tx) => {
        for (const item of batch) {
          const fx = fxByPeriod.get(item.charge.periodStart.toISOString());
          if (!fx) continue;
          if (item.charge.kind === "shared" && item.sharedAllocation) {
            const markedTotal = computeMarkedGbpMinor(item.charge.nativeAmount, fx.rate);
            const allocation = allocateSharedPence(
              markedTotal,
              item.sharedAllocation.membership,
              billing.projectId,
            );
            if (allocation.denominator === 0 || allocation.share === BigInt(0)) {
              await recordQuarantine(tx, {
                sourceKind: "VERCEL_FOCUS",
                bucketKey: `${item.charge.bucketKey}:unallocated`,
                checksum: item.charge.checksum,
                periodStart: item.charge.periodStart,
                periodEnd: item.charge.periodEnd,
                reason: "Shared charge could not be allocated to an active project.",
              });
              quarantinedCount += 1;
              continue;
            }
            const result = await applyClassifiedCharge(tx, {
              sourceKind: "VERCEL_FOCUS",
              bucketKey: item.charge.bucketKey,
              checksum: item.checksum,
              category: "SHARED_VERCEL",
              invoiceability: item.invoiceability,
              nativeAmount: item.charge.nativeAmount,
              nativeCurrency: item.charge.nativeCurrency,
              rate: fx.rate,
              fxRateSnapshotId: fx.id,
              periodStart: item.charge.periodStart,
              periodEnd: item.charge.periodEnd,
              displayLabel: item.charge.displayLabel,
              metadata: {
                projectIds: allocation.membership,
                denominator: allocation.denominator,
                remainderMethod: "sorted-project-id",
                infrastructureMarkupPercent: 20,
              },
              startedAt: config.startedAt,
              markedGbpMinor: allocation.share,
            });
            if (result !== "skipped") classifiedCount += 1;
            continue;
          }

          const result = await applyClassifiedCharge(tx, {
            sourceKind: "VERCEL_FOCUS",
            bucketKey: item.charge.bucketKey,
            checksum: item.checksum,
            category: item.charge.category!,
            invoiceability: item.invoiceability,
            nativeAmount: item.charge.nativeAmount,
            nativeCurrency: item.charge.nativeCurrency,
            rate: fx.rate,
            fxRateSnapshotId: fx.id,
            periodStart: item.charge.periodStart,
            periodEnd: item.charge.periodEnd,
            displayLabel: item.charge.displayLabel,
            metadata: { infrastructureMarkupPercent: 20 },
            startedAt: config.startedAt,
          });
          if (result !== "skipped") classifiedCount += 1;
        }
      });
    }

    const quarantineSamples = [
      ...new Map(
        [
          ...charges.quarantined.map((item) => item.reason),
          ...classified.quarantined.map((item) => item.reason),
        ]
          .filter(Boolean)
          .map((reason) => [reason, reason] as const),
      ).values(),
    ].slice(0, 10);
    if (quarantineSamples.length > 0) {
      await runSerializable(async (tx) => {
        for (const reason of quarantineSamples) {
          const checksum = createHash("sha256").update(`sample:${reason}`).digest("hex");
          await recordQuarantine(tx, {
            sourceKind: "VERCEL_FOCUS",
            bucketKey: `vercel:quarantine:${checksum}`,
            checksum,
            periodStart: window.from,
            periodEnd: window.to,
            reason,
          });
        }
      });
    }

    if (work.hasMore) {
      await costDb.costSyncRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          errorCode: COST_SYNC_CONTINUE_CODE,
          classifiedCount,
          quarantinedCount,
          completedAt: new Date(),
        },
      });
      return {
        status: "partial",
        runId: run.id,
        classifiedCount,
        quarantinedCount,
        errorCode: COST_SYNC_CONTINUE_CODE,
        caughtUp: false,
        queryFrom: window.from.toISOString(),
        queryTo: window.to.toISOString(),
      };
    }

    const checksum = createHash("sha256")
      .update(`${classifiedCount}:${quarantinedCount}:${window.from.toISOString()}`)
      .digest("hex");

    await costDb.costSyncRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCEEDED",
        classifiedCount,
        quarantinedCount,
        checksum,
        completedAt: new Date(),
      },
    });

    return {
      status: "succeeded",
      runId: run.id,
      classifiedCount,
      quarantinedCount,
      caughtUp: window.caughtUp,
      queryFrom: window.from.toISOString(),
      queryTo: window.to.toISOString(),
    };
  } catch (error) {
    const errorCode = classifyCostSyncFailure(error);
    await costDb.costSyncRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        errorCode,
        classifiedCount,
        completedAt: new Date(),
      },
    });
    return { status: "failed", runId: run.id, classifiedCount, errorCode };
  }
}

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
import {
  getCursorSubscriptionUsdMinor,
  parseCursorUsageLog,
  planCursorCharges,
} from "@/lib/costs/cursor";
import { isOnOrAfterLaunch } from "@/lib/costs/dates";
import cursorUsageLog from "@/data/cursor-usage.json";
import { getOrCreateUsdGbpRate } from "@/lib/costs/fx";
import { applyClassifiedCharge, ensureLedgerConfig, recordQuarantine } from "@/lib/costs/ledger";
import { renewCostSyncLock, withCostSyncLock } from "@/lib/costs/lock";
import { allocateSharedPence } from "@/lib/costs/shared";
import { computeMarkedGbpMinor } from "@/lib/costs/money";
import { runSerializable } from "@/lib/costs/transaction";
import {
  CostProviderUnavailableError,
  fetchFocusCharges,
  listActiveProductionProjectIds,
} from "@/lib/costs/vercel";
import { db } from "@/lib/db";

export interface CostSyncResult {
  status: "skipped" | "locked" | "succeeded" | "failed";
  runId?: string;
  classifiedCount?: number;
  quarantinedCount?: number;
  errorCode?: string;
}

function syncWindow(startedAt: Date, now: Date) {
  const earliest = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const from = startedAt > earliest ? startedAt : earliest;
  return { from, to: now };
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
    const existing = await db.costSyncRun.findUnique({
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
    return executeCostSync(input, holder);
  });

  if (!locked.acquired) {
    return { status: "locked" };
  }
  return locked.result;
}

/**
 * Allocates this project's fair share of the flat Cursor subscription from the
 * committed usage log. Absent configuration or an empty log is not a failure:
 * the Vercel importer must still complete.
 */
async function importCursorSubscriptionShare(input: {
  startedAt: Date;
  now: Date;
  env: NodeJS.ProcessEnv;
  lockHolder: string;
}): Promise<number> {
  const monthlyUsdMinor = getCursorSubscriptionUsdMinor(input.env);
  if (!monthlyUsdMinor) return 0;

  const log = parseCursorUsageLog(cursorUsageLog);
  const charges = planCursorCharges({
    log,
    startedAt: input.startedAt,
    now: input.now,
    monthlyUsdMinor,
  });

  let applied = 0;
  for (const charge of charges) {
    await renewCostSyncLock(input.lockHolder);
    await runSerializable(async (tx) => {
      const fx = await getOrCreateUsdGbpRate(tx, charge.periodStart);
      const result = await applyClassifiedCharge(tx, {
        sourceKind: "CURSOR_USAGE",
        bucketKey: charge.bucketKey,
        checksum: charge.checksum,
        category: "CURSOR",
        invoiceability: "INVOICEABLE",
        nativeAmount: charge.nativeAmount,
        nativeCurrency: charge.nativeCurrency,
        rate: fx.rate,
        fxRateSnapshotId: fx.id,
        periodStart: charge.periodStart,
        periodEnd: charge.periodEnd,
        displayLabel: charge.displayLabel,
        metadata: charge.metadata,
        startedAt: input.startedAt,
      });
      if (result !== "skipped") applied += 1;
    });
  }
  return applied;
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

  const window = syncWindow(config.startedAt, now);
  const existingRun = input.eventId
    ? await db.costSyncRun.findUnique({ where: { eventId: input.eventId } })
    : null;
  const run = existingRun
    ? await db.costSyncRun.update({
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
    : await db.costSyncRun.create({
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
    // Cursor allocation comes from a committed local log, so it must not be held
    // hostage by a provider outage on the Vercel side of the same run.
    classifiedCount += await importCursorSubscriptionShare({
      startedAt: config.startedAt,
      now,
      env,
      lockHolder,
    });

    const billing = getVercelBillingConfig(env);
    const charges = await fetchFocusCharges({
      from: window.from,
      to: window.to,
      env,
    });
    const classified = classifyFocusRows(charges.rows, {
      projectId: billing.projectId,
      databaseResourceId: billing.databaseResourceId,
      now,
    });

    let quarantinedCount = charges.quarantined.length + classified.quarantined.length;

    for (const item of charges.quarantined) {
      await runSerializable((tx) =>
        recordQuarantine(tx, {
          sourceKind: "VERCEL_FOCUS",
          bucketKey: `vercel:quarantine:parse:${item.rawIndex}`,
          checksum: createHash("sha256").update(item.reason).digest("hex"),
          periodStart: window.from,
          periodEnd: window.to,
          reason: item.reason,
        }),
      );
    }

    for (const item of classified.quarantined) {
      await runSerializable((tx) =>
        recordQuarantine(tx, {
          sourceKind: "VERCEL_FOCUS",
          bucketKey: `vercel:quarantine:${item.rawIndex ?? "unknown"}`,
          checksum: createHash("sha256")
            .update(item.reason + (item.row ? item.row.ServiceName : ""))
            .digest("hex"),
          periodStart: item.row ? new Date(item.row.ChargePeriodStart) : window.from,
          periodEnd: item.row ? new Date(item.row.ChargePeriodEnd) : window.to,
          reason: item.reason,
        }),
      );
    }

    const sharedMembershipCache = new Map<string, string[]>();
    const ledgerCharges = aggregateClassifiedCharges(classified.classified);

    for (const charge of ledgerCharges) {
      await renewCostSyncLock(lockHolder);
      if (!isOnOrAfterLaunch(charge.periodStart, config.startedAt)) {
        continue;
      }

      await runSerializable(async (tx) => {
        const fx = await getOrCreateUsdGbpRate(tx, charge.periodStart);
        if (charge.kind === "shared") {
          const membershipKey = `${charge.periodStart.toISOString()}:${charge.periodEnd.toISOString()}`;
          let membership = sharedMembershipCache.get(membershipKey);
          if (!membership) {
            membership = await listActiveProductionProjectIds({
              from: charge.periodStart,
              to: charge.periodEnd,
              env,
            });
            sharedMembershipCache.set(membershipKey, membership);
          }
          const markedTotal = computeMarkedGbpMinor(charge.nativeAmount, fx.rate);
          const allocation = allocateSharedPence(
            markedTotal,
            membership,
            billing.projectId,
          );
          if (allocation.denominator === 0 || allocation.share === BigInt(0)) {
            await recordQuarantine(tx, {
              sourceKind: "VERCEL_FOCUS",
              bucketKey: `${charge.bucketKey}:unallocated`,
              checksum: charge.checksum,
              periodStart: charge.periodStart,
              periodEnd: charge.periodEnd,
              reason: "Shared charge could not be allocated to an active project.",
            });
            quarantinedCount += 1;
            return;
          }

          const checksum = sharedMembershipChecksum(
            charge.checksum,
            allocation.membership,
            charge.invoiceability ?? "PROVISIONAL",
          );
          const result = await applyClassifiedCharge(tx, {
            sourceKind: "VERCEL_FOCUS",
            bucketKey: charge.bucketKey,
            checksum,
            category: "SHARED_VERCEL",
            invoiceability: charge.invoiceability ?? "PROVISIONAL",
            nativeAmount: charge.nativeAmount,
            nativeCurrency: charge.nativeCurrency,
            rate: fx.rate,
            fxRateSnapshotId: fx.id,
            periodStart: charge.periodStart,
            periodEnd: charge.periodEnd,
            displayLabel: charge.displayLabel,
            metadata: {
              projectIds: allocation.membership,
              denominator: allocation.denominator,
              remainderMethod: "sorted-project-id",
            },
            startedAt: config.startedAt,
            markedGbpMinor: allocation.share,
          });
          if (result !== "skipped") classifiedCount += 1;
          return;
        }

        const result = await applyClassifiedCharge(tx, {
          sourceKind: "VERCEL_FOCUS",
          bucketKey: charge.bucketKey,
          checksum: charge.checksum,
          category: charge.category!,
          invoiceability: charge.invoiceability ?? "INVOICEABLE",
          nativeAmount: charge.nativeAmount,
          nativeCurrency: charge.nativeCurrency,
          rate: fx.rate,
          fxRateSnapshotId: fx.id,
          periodStart: charge.periodStart,
          periodEnd: charge.periodEnd,
          displayLabel: charge.displayLabel,
          startedAt: config.startedAt,
        });
        if (result !== "skipped") classifiedCount += 1;
      });
    }

    const checksum = createHash("sha256")
      .update(`${classifiedCount}:${quarantinedCount}:${window.from.toISOString()}`)
      .digest("hex");

    await db.costSyncRun.update({
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
    };
  } catch (error) {
    const errorCode =
      error instanceof CostProviderUnavailableError
        ? error.code
        : error instanceof Prisma.PrismaClientKnownRequestError
          ? error.code
          : error instanceof Error
            ? error.name
            : "COST_SYNC_FAILED";
    await db.costSyncRun.update({
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

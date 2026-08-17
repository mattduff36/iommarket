import type {
  CostCategory,
  CostInvoiceability,
  CostSourceKind,
  Prisma,
} from "@prisma/client";
import {
  assertLedgerConfigMatchesEnvironment,
  COST_LEDGER_CONFIG_ID,
  CostConfigError,
  getCostLedgerStartedAt,
  getCostPolicyVersion,
} from "@/lib/costs/config";
import { isOnOrAfterLaunch } from "@/lib/costs/dates";
import { planLedgerRevision, type ExistingLedgerRevision } from "@/lib/costs/ledger-plan";
import { computeMarkedGbpMinor, negateMinor } from "@/lib/costs/money";

export class CostLedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CostLedgerError";
  }
}

type LedgerClient = Prisma.TransactionClient;

export async function ensureLedgerConfig(client: LedgerClient) {
  const existing = await client.costLedgerConfig.findUnique({
    where: { id: COST_LEDGER_CONFIG_ID },
  });
  if (existing) {
    try {
      assertLedgerConfigMatchesEnvironment(existing);
    } catch (error) {
      if (error instanceof CostConfigError) {
        throw new CostLedgerError(error.message);
      }
      throw error;
    }
    return existing;
  }

  return client.costLedgerConfig.create({
    data: {
      id: COST_LEDGER_CONFIG_ID,
      startedAt: getCostLedgerStartedAt(),
      policyVersion: getCostPolicyVersion(),
    },
  });
}

export async function getLatestBucketRevision(
  client: LedgerClient,
  sourceKind: CostSourceKind,
  bucketKey: string,
): Promise<ExistingLedgerRevision | null> {
  const snapshot = await client.costSourceSnapshot.findFirst({
    where: { sourceKind, bucketKey, classified: true, quarantined: false },
    orderBy: { revision: "desc" },
    include: {
      entries: {
        where: { kind: "CHARGE" },
      },
    },
  });
  if (!snapshot) return null;
  const charge = snapshot.entries[0];
  if (!charge) return null;
  return {
    revision: snapshot.revision,
    checksum: snapshot.checksum,
    invoiceability: charge.invoiceability,
    chargeEntryId: charge.id,
    markedGbpMinor: charge.markedGbpMinor,
    fxRateSnapshotId: charge.fxRateSnapshotId,
    nativeAmount: charge.nativeAmount.toString(),
    nativeCurrency: charge.nativeCurrency,
  };
}

export async function applyClassifiedCharge(
  client: LedgerClient,
  input: {
    sourceKind: CostSourceKind;
    bucketKey: string;
    checksum: string;
    category: CostCategory;
    invoiceability: CostInvoiceability;
    nativeAmount: string;
    nativeCurrency: string;
    rate: string;
    fxRateSnapshotId: string;
    periodStart: Date;
    periodEnd: Date;
    displayLabel: string;
    metadata?: Prisma.InputJsonValue;
    startedAt: Date;
    markedGbpMinor?: bigint;
  },
): Promise<"skipped" | "created" | "revised"> {
  if (!isOnOrAfterLaunch(input.periodStart, input.startedAt)) {
    throw new CostLedgerError("Cost is before the ledger launch boundary.");
  }

  const existing = await getLatestBucketRevision(client, input.sourceKind, input.bucketKey);
  const plan = planLedgerRevision(existing, {
    checksum: input.checksum,
    invoiceability: input.invoiceability,
  });
  if (plan.type === "skip") return "skipped";

  const markedGbpMinor =
    input.markedGbpMinor ?? computeMarkedGbpMinor(input.nativeAmount, input.rate);
  const revision = plan.type === "create" ? 1 : plan.nextRevision;
  const snapshot = await client.costSourceSnapshot.create({
    data: {
      sourceKind: input.sourceKind,
      bucketKey: input.bucketKey,
      revision,
      checksum: input.checksum,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      classified: true,
      quarantined: false,
      metadata: input.metadata,
    },
  });

  if (plan.type === "reverse-replace") {
    await client.costEntry.create({
      data: {
        category: input.category,
        kind: "REVERSAL",
        invoiceability: existing!.invoiceability,
        sourceKind: input.sourceKind,
        sourceSnapshotId: snapshot.id,
        reversesEntryId: plan.reverseEntryId,
        fxRateSnapshotId: plan.originalFxRateSnapshotId,
        nativeAmount: plan.originalNativeAmount,
        nativeCurrency: plan.originalNativeCurrency,
        markedGbpMinor: negateMinor(plan.originalMarkedGbpMinor),
        servicePeriodStart: input.periodStart,
        servicePeriodEnd: input.periodEnd,
        displayLabel: input.displayLabel,
      },
    });
  }

  await client.costEntry.create({
    data: {
      category: input.category,
      kind: "CHARGE",
      invoiceability: input.invoiceability,
      sourceKind: input.sourceKind,
      sourceSnapshotId: snapshot.id,
      fxRateSnapshotId: input.fxRateSnapshotId,
      nativeAmount: input.nativeAmount,
      nativeCurrency: input.nativeCurrency,
      markedGbpMinor,
      servicePeriodStart: input.periodStart,
      servicePeriodEnd: input.periodEnd,
      displayLabel: input.displayLabel,
    },
  });

  return plan.type === "create" ? "created" : "revised";
}

export async function recordQuarantine(
  client: LedgerClient,
  input: {
    sourceKind: CostSourceKind;
    bucketKey: string;
    checksum: string;
    periodStart: Date;
    periodEnd: Date;
    reason: string;
  },
) {
  const latest = await client.costSourceSnapshot.findFirst({
    where: { sourceKind: input.sourceKind, bucketKey: input.bucketKey },
    orderBy: { revision: "desc" },
  });
  if (latest?.checksum === input.checksum && latest.quarantined) return;

  await client.costSourceSnapshot.create({
    data: {
      sourceKind: input.sourceKind,
      bucketKey: input.bucketKey,
      revision: (latest?.revision ?? 0) + 1,
      checksum: input.checksum,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      classified: false,
      quarantined: true,
      quarantineReason: input.reason,
    },
  });
}

import { faceValueChecksum } from "@/lib/costs/classify";
import { costDb } from "@/lib/costs/db";
import { getOrCreateIdentityGbpRate, getOrCreateUsdGbpRate } from "@/lib/costs/fx";
import { applyClassifiedCharge, ensureLedgerConfig } from "@/lib/costs/ledger";
import { computeUnmarkedGbpMinor } from "@/lib/costs/money";
import { runSerializable } from "@/lib/costs/transaction";
import type { RecordManualCostInput } from "@/lib/validations/costs";

const MANUAL_REPRICE_LIMIT = 75;

export async function recordManualLedgerCost(input: RecordManualCostInput): Promise<void> {
  await runSerializable(async (tx) => {
    const config = await ensureLedgerConfig(tx);
    const periodStart = new Date(input.periodStart);
    const periodEnd = new Date(input.periodEnd);
    const fx =
      input.nativeCurrency === "GBP"
        ? await getOrCreateIdentityGbpRate(tx, periodStart)
        : await getOrCreateUsdGbpRate(tx, periodStart);

    await applyClassifiedCharge(tx, {
      sourceKind: "MANUAL",
      bucketKey: `manual:${input.category}:${input.externalRef}`,
      checksum: faceValueChecksum(
        `manual:${input.category}:${input.externalRef}:${input.nativeAmount}:${input.nativeCurrency}`,
      ),
      category: input.category,
      invoiceability: "INVOICEABLE",
      nativeAmount: input.nativeAmount,
      nativeCurrency: input.nativeCurrency,
      rate: fx.rate,
      fxRateSnapshotId: fx.id,
      periodStart,
      periodEnd,
      displayLabel: input.displayLabel,
      startedAt: config.startedAt,
      metadata:
        input.category === "DATABASE"
          ? { providerInvoiceId: input.externalRef }
          : undefined,
    });
  });
}

export async function repriceManualChargesToFaceValue(): Promise<{
  written: number;
  hasMore: boolean;
}> {
  const snapshots = await costDb.costSourceSnapshot.findMany({
    where: { sourceKind: "MANUAL", classified: true, quarantined: false },
    orderBy: [{ bucketKey: "asc" }, { revision: "desc" }],
    include: {
      entries: {
        where: { kind: "CHARGE" },
        include: { fxRateSnapshot: true },
      },
    },
  });

  const latestByBucket = new Map<string, (typeof snapshots)[number]>();
  for (const snapshot of snapshots) {
    if (!latestByBucket.has(snapshot.bucketKey)) latestByBucket.set(snapshot.bucketKey, snapshot);
  }

  const stale = [...latestByBucket.values()].flatMap((snapshot) => {
    const charge = snapshot.entries[0];
    const rateSnapshot = charge?.fxRateSnapshot;
    if (!charge || !rateSnapshot) return [];
    const faceValue = computeUnmarkedGbpMinor(
      charge.nativeAmount.toString(),
      rateSnapshot.rate.toString(),
    );
    if (faceValue === charge.markedGbpMinor) return [];
    return [{ snapshot, charge, rateSnapshot, faceValue }];
  });

  const batch = stale.slice(0, MANUAL_REPRICE_LIMIT);
  if (batch.length === 0) return { written: 0, hasMore: false };

  await runSerializable(async (tx) => {
    const config = await ensureLedgerConfig(tx);
    for (const item of batch) {
      await applyClassifiedCharge(tx, {
        sourceKind: "MANUAL",
        bucketKey: item.snapshot.bucketKey,
        checksum: faceValueChecksum(item.snapshot.checksum),
        category: item.charge.category,
        invoiceability: item.charge.invoiceability,
        nativeAmount: item.charge.nativeAmount.toString(),
        nativeCurrency: item.charge.nativeCurrency,
        rate: item.rateSnapshot.rate.toString(),
        fxRateSnapshotId: item.rateSnapshot.id,
        periodStart: item.charge.servicePeriodStart,
        periodEnd: item.charge.servicePeriodEnd,
        displayLabel: item.charge.displayLabel,
        startedAt: config.startedAt,
        markedGbpMinor: item.faceValue,
      });
    }
  });

  return { written: batch.length, hasMore: stale.length > batch.length };
}

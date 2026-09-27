import { faceValueChecksum } from "@/lib/costs/classify";
import { utcDateFromString, toUtcDateString } from "@/lib/costs/dates";
import { costDb } from "@/lib/costs/db";
import { getOrCreateIdentityGbpRate } from "@/lib/costs/fx";
import { applyClassifiedCharge, ensureLedgerConfig, listLatestBucketRevisions } from "@/lib/costs/ledger";
import { planLedgerRevision } from "@/lib/costs/ledger-plan";
import { computeUnmarkedGbpMinor } from "@/lib/costs/money";
import { runSerializable } from "@/lib/costs/transaction";

export const VERCEL_MEMBERSHIP_DAILY_GBP = "0.38";
export const VERCEL_MEMBERSHIP_LABEL = "Vercel Pro membership share";
const MEMBERSHIP_WRITES_PER_RUN = 75;
export const MEMBERSHIP_TRANSACTION_BATCH_SIZE = 1;

export interface VercelMembershipDay {
  day: string;
  bucketKey: string;
  checksum: string;
  periodStart: Date;
  periodEnd: Date;
  nativeAmount: string;
  displayLabel: string;
}

export function vercelMembershipDays(startedAt: Date, now: Date): VercelMembershipDay[] {
  const last = utcDateFromString(toUtcDateString(now));
  const days: VercelMembershipDay[] = [];
  let cursor = utcDateFromString(toUtcDateString(startedAt));

  while (cursor.getTime() <= last.getTime()) {
    const next = new Date(cursor);
    next.setUTCDate(next.getUTCDate() + 1);
    const periodStart = cursor.getTime() < startedAt.getTime() ? startedAt : cursor;
    if (periodStart.getTime() < next.getTime()) {
      const day = toUtcDateString(cursor);
      days.push({
        day,
        bucketKey: `vercel:membership:${day}`,
        checksum: faceValueChecksum(
          `vercel:membership:${day}:${VERCEL_MEMBERSHIP_DAILY_GBP}:GBP`,
        ),
        periodStart,
        periodEnd: next,
        nativeAmount: VERCEL_MEMBERSHIP_DAILY_GBP,
        displayLabel: VERCEL_MEMBERSHIP_LABEL,
      });
    }
    cursor = next;
  }

  return days;
}

export function vercelMembershipDailyMinor(): bigint {
  return computeUnmarkedGbpMinor(VERCEL_MEMBERSHIP_DAILY_GBP, "1");
}

export async function recordVercelMembershipShare(input: {
  startedAt: Date;
  now: Date;
}): Promise<{ written: number; hasMore: boolean }> {
  const days = vercelMembershipDays(input.startedAt, input.now);
  const existing = await listLatestBucketRevisions(
    costDb,
    "MANUAL",
    days.map((day) => day.bucketKey),
  );
  const pending = days.filter((day) => {
    const plan = planLedgerRevision(existing.get(day.bucketKey) ?? null, {
      checksum: day.checksum,
      invoiceability: "INVOICEABLE",
    });
    return plan.type !== "skip";
  });
  const batch = pending.slice(0, MEMBERSHIP_WRITES_PER_RUN);
  if (batch.length === 0) return { written: 0, hasMore: false };

  for (let index = 0; index < batch.length; index += MEMBERSHIP_TRANSACTION_BATCH_SIZE) {
    const transactionBatch = batch.slice(
      index,
      index + MEMBERSHIP_TRANSACTION_BATCH_SIZE,
    );
    await runSerializable(async (tx) => {
      const config = await ensureLedgerConfig(tx);
      for (const day of transactionBatch) {
        const fx = await getOrCreateIdentityGbpRate(tx, day.periodStart);
        await applyClassifiedCharge(tx, {
          sourceKind: "MANUAL",
          bucketKey: day.bucketKey,
          checksum: day.checksum,
          category: "VERCEL_HOSTING",
          invoiceability: "INVOICEABLE",
          nativeAmount: day.nativeAmount,
          nativeCurrency: "GBP",
          rate: fx.rate,
          fxRateSnapshotId: fx.id,
          periodStart: day.periodStart,
          periodEnd: day.periodEnd,
          displayLabel: day.displayLabel,
          startedAt: config.startedAt,
          markedGbpMinor: vercelMembershipDailyMinor(),
        });
      }
    });
  }

  return { written: batch.length, hasMore: pending.length > batch.length };
}

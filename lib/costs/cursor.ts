import { createHash } from "node:crypto";
import { z } from "zod";
import { CostConfigError } from "@/lib/costs/config";

/**
 * Cursor usage cannot be billed as metered spend: the Ultra subscription is a
 * flat monthly fee and in-plan usage costs nothing extra. The subscription is
 * therefore sliced per calendar day and each day's slice is allocated by this
 * project's share of that day's identified Cursor usage. Usage that no local
 * transcript claims is excluded from both sides of the ratio, so an unidentified
 * conversation can never inflate or deflate the client's share.
 */

export class CursorUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CursorUsageError";
  }
}

const MICRO_CENT_STRING = /^\d+$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const microCents = z.string().regex(MICRO_CENT_STRING, "Micro cents must be a whole number.");
const tokenCount = z.number().int().min(0);

export const cursorUsageLogSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().min(1),
  projectKey: z.string().min(1),
  attributionCoverage: z
    .object({
      attributedEvents: z.number().int().min(0),
      unattributedEvents: z.number().int().min(0),
      unattributedMicroCents: microCents.optional(),
    })
    .optional(),
  days: z.array(
    z.object({
      date: z.string().regex(ISO_DATE, "Day must be an ISO calendar date."),
      identifiedMicroCents: microCents,
      project: z.object({
        onDemandMicroCents: microCents,
        chargedMicroCents: microCents.optional(),
        inputTokens: tokenCount,
        outputTokens: tokenCount,
        cacheWriteTokens: tokenCount,
        cacheReadTokens: tokenCount,
        models: z
          .array(z.object({ model: z.string().min(1), onDemandMicroCents: microCents }))
          .optional(),
      }),
    }),
  ),
});

export type CursorUsageLog = z.infer<typeof cursorUsageLogSchema>;

export interface CursorPlannedCharge {
  bucketKey: string;
  checksum: string;
  periodStart: Date;
  periodEnd: Date;
  nativeAmount: string;
  nativeCurrency: "USD";
  displayLabel: string;
  metadata: {
    date: string;
    subscriptionSliceUsdMinor: number;
    shareParts: number;
    identifiedMicroCents: string;
    projectMicroCents: string;
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
  };
}

export function parseCursorUsageLog(value: unknown): CursorUsageLog {
  const parsed = cursorUsageLogSchema.safeParse(value);
  if (!parsed.success) {
    throw new CursorUsageError("Cursor usage log is not valid.");
  }
  const seen = new Set<string>();
  for (const day of parsed.data.days) {
    if (seen.has(day.date)) {
      throw new CursorUsageError("Cursor usage log contains duplicate days.");
    }
    seen.add(day.date);
    if (!isRealCalendarDate(day.date)) {
      throw new CursorUsageError("Cursor usage log contains an impossible date.");
    }
    if (BigInt(day.project.onDemandMicroCents) > BigInt(day.identifiedMicroCents)) {
      throw new CursorUsageError(
        "Cursor usage log claims more project usage than identified usage.",
      );
    }
  }
  return parsed.data;
}

function isRealCalendarDate(date: string): boolean {
  const match = date.match(ISO_DATE);
  if (!match) return false;
  const [, year, month, day] = match;
  const utc = new Date(`${date}T00:00:00.000Z`);
  return (
    utc.getUTCFullYear() === Number(year) &&
    utc.getUTCMonth() + 1 === Number(month) &&
    utc.getUTCDate() === Number(day)
  );
}

export function getCursorSubscriptionUsdMinor(
  env: NodeJS.ProcessEnv = process.env,
): bigint | null {
  const raw = env.COST_CURSOR_SUBSCRIPTION_USD_MINOR?.trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) {
    throw new CostConfigError(
      "COST_CURSOR_SUBSCRIPTION_USD_MINOR must be whole minor units.",
    );
  }
  const value = BigInt(raw);
  if (value <= BigInt(0)) {
    throw new CostConfigError("COST_CURSOR_SUBSCRIPTION_USD_MINOR must be positive.");
  }
  return value;
}

export function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Distributes the monthly fee across a month's days so the daily slices sum to
 * exactly the subscription: slice(i) = floor(total×(i+1)/n) − floor(total×i/n).
 */
export function subscriptionSliceUsdMinor(input: {
  monthlyUsdMinor: bigint;
  dayOfMonth: number;
  daysInMonth: number;
}): bigint {
  const { monthlyUsdMinor, dayOfMonth, daysInMonth } = input;
  if (daysInMonth <= 0 || dayOfMonth < 1 || dayOfMonth > daysInMonth) {
    throw new CursorUsageError("Day is outside the month.");
  }
  const index = BigInt(dayOfMonth - 1);
  const count = BigInt(daysInMonth);
  return (
    (monthlyUsdMinor * (index + BigInt(1))) / count - (monthlyUsdMinor * index) / count
  );
}

/** Floors the share so an allocation never exceeds the day's own slice. */
export function allocateProjectShareUsdMinor(input: {
  sliceUsdMinor: bigint;
  projectMicroCents: bigint;
  identifiedMicroCents: bigint;
}): bigint {
  if (input.identifiedMicroCents <= BigInt(0)) return BigInt(0);
  const numerator =
    input.sliceUsdMinor *
    (input.projectMicroCents > input.identifiedMicroCents
      ? input.identifiedMicroCents
      : input.projectMicroCents);
  return numerator / input.identifiedMicroCents;
}

function minorToDecimalString(minor: bigint): string {
  const whole = minor / BigInt(100);
  const fraction = (minor % BigInt(100)).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}

function formatTokenCount(total: number): string {
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M`;
  if (total >= 1_000) return `${Math.round(total / 1_000)}k`;
  return String(total);
}

function formatDayLabel(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function planCursorCharges(input: {
  log: CursorUsageLog;
  startedAt: Date;
  now: Date;
  monthlyUsdMinor: bigint;
}): CursorPlannedCharge[] {
  const charges: CursorPlannedCharge[] = [];

  for (const day of input.log.days) {
    const periodStart = new Date(`${day.date}T00:00:00.000Z`);
    const periodEnd = new Date(periodStart.getTime() + 86_400_000);
    if (periodStart.getTime() < input.startedAt.getTime()) continue;
    if (periodEnd.getTime() > input.now.getTime()) continue;

    const identified = BigInt(day.identifiedMicroCents);
    const projectMicro = BigInt(day.project.onDemandMicroCents);
    if (identified <= BigInt(0) || projectMicro <= BigInt(0)) continue;

    const sliceUsdMinor = subscriptionSliceUsdMinor({
      monthlyUsdMinor: input.monthlyUsdMinor,
      dayOfMonth: periodStart.getUTCDate(),
      daysInMonth: daysInUtcMonth(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1),
    });
    const shareUsdMinor = allocateProjectShareUsdMinor({
      sliceUsdMinor,
      projectMicroCents: projectMicro,
      identifiedMicroCents: identified,
    });
    if (shareUsdMinor <= BigInt(0)) continue;

    const tokens =
      day.project.inputTokens +
      day.project.outputTokens +
      day.project.cacheWriteTokens +
      day.project.cacheReadTokens;
    const shareParts = Number((projectMicro * BigInt(10_000)) / identified);
    const metadata = {
      date: day.date,
      subscriptionSliceUsdMinor: Number(sliceUsdMinor),
      shareParts,
      identifiedMicroCents: day.identifiedMicroCents,
      projectMicroCents: day.project.onDemandMicroCents,
      inputTokens: day.project.inputTokens,
      outputTokens: day.project.outputTokens,
      cacheWriteTokens: day.project.cacheWriteTokens,
      cacheReadTokens: day.project.cacheReadTokens,
    };

    charges.push({
      bucketKey: `cursor:subscription:${day.date}`,
      checksum: createHash("sha256")
        .update(
          [
            day.date,
            day.identifiedMicroCents,
            day.project.onDemandMicroCents,
            sliceUsdMinor.toString(),
            shareUsdMinor.toString(),
            String(tokens),
          ].join("|"),
        )
        .digest("hex"),
      periodStart,
      periodEnd,
      nativeAmount: minorToDecimalString(shareUsdMinor),
      nativeCurrency: "USD",
      displayLabel: `Cursor ${formatDayLabel(day.date)} - ${formatTokenCount(tokens)} tokens, ${(
        shareParts / 100
      ).toFixed(1)}% of tracked usage`,
      metadata,
    });
  }

  return charges;
}

import type { Prisma } from "@prisma/client";
import {
  COST_FX_PAIR_USD_GBP,
  COST_FX_PROVIDER,
  COST_IDENTITY_FX_PROVIDER,
} from "@/lib/costs/config";
import { previousBusinessDay, toUtcDateString, utcDateFromString } from "@/lib/costs/dates";
import { decimalToString, parseDecimalString } from "@/lib/costs/money";

export class CostFxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CostFxError";
  }
}

export interface FxRateRecord {
  id: string;
  pair: string;
  rate: string;
  provider: string;
  captureDate: Date;
  effectiveDate: Date;
}

type FxClient = {
  fxRateSnapshot: Pick<
    Prisma.TransactionClient["fxRateSnapshot"],
    "findFirst" | "upsert"
  >;
};

interface FrankfurterResponse {
  date?: string;
  rates?: { GBP?: number | string };
}

export async function fetchFrankfurterRate(
  date: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ rate: string; effectiveDate: string }> {
  const response = await fetchImpl(
    `https://api.frankfurter.app/${date}?from=USD&to=GBP`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new CostFxError(`FX provider returned ${response.status}.`);
  }
  const body = (await response.json()) as FrankfurterResponse;
  const rateValue = body.rates?.GBP;
  if (rateValue === undefined || rateValue === null) {
    throw new CostFxError("FX provider did not return a USD/GBP rate.");
  }
  const rate = String(rateValue);
  const parsed = parseDecimalString(rate);
  if (parsed.unscaled <= BigInt(0)) {
    throw new CostFxError("FX rate must be a positive decimal.");
  }
  if (!body.date) {
    throw new CostFxError("FX provider did not return an effective date.");
  }
  return { rate, effectiveDate: toUtcDateString(body.date) };
}

export async function getOrCreateUsdGbpRate(
  client: FxClient,
  captureDate: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<FxRateRecord> {
  let cursor = previousBusinessDay(captureDate);
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const existing = await client.fxRateSnapshot.findFirst({
      where: {
        pair: COST_FX_PAIR_USD_GBP,
        provider: COST_FX_PROVIDER,
        effectiveDate: utcDateFromString(cursor),
      },
    });
    if (existing) {
      return {
        id: existing.id,
        pair: existing.pair,
        rate: existing.rate.toString(),
        provider: existing.provider,
        captureDate: existing.captureDate,
        effectiveDate: existing.effectiveDate,
      };
    }

    try {
      const fetched = await fetchFrankfurterRate(cursor, fetchImpl);
      const requested = utcDateFromString(cursor).getTime();
      const effective = utcDateFromString(fetched.effectiveDate).getTime();
      if (effective > requested || requested - effective > 10 * 86_400_000) {
        throw new CostFxError("FX effective date is outside the allowed window.");
      }
      const created = await client.fxRateSnapshot.upsert({
        where: {
          pair_effectiveDate_provider: {
            pair: COST_FX_PAIR_USD_GBP,
            effectiveDate: utcDateFromString(fetched.effectiveDate),
            provider: COST_FX_PROVIDER,
          },
        },
        update: {},
        create: {
          pair: COST_FX_PAIR_USD_GBP,
          rate: fetched.rate,
          provider: COST_FX_PROVIDER,
          captureDate: utcDateFromString(cursor),
          effectiveDate: utcDateFromString(fetched.effectiveDate),
          fetchedAt: new Date(),
        },
      });
      return {
        id: created.id,
        pair: created.pair,
        rate: created.rate.toString(),
        provider: created.provider,
        captureDate: created.captureDate,
        effectiveDate: created.effectiveDate,
      };
    } catch (error) {
      if (attempt === 6) {
        throw error instanceof CostFxError
          ? error
          : new CostFxError("FX rate is unavailable.");
      }
      const dayBefore = utcDateFromString(cursor);
      dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
      cursor = previousBusinessDay(dayBefore);
    }
  }

  throw new CostFxError("FX rate is unavailable.");
}

export async function getOrCreateIdentityGbpRate(
  client: FxClient,
  captureDate: Date,
): Promise<FxRateRecord> {
  const date = utcDateFromString(toUtcDateString(captureDate));
  const created = await client.fxRateSnapshot.upsert({
    where: {
      pair_effectiveDate_provider: {
        pair: "GBPGBP",
        effectiveDate: date,
        provider: COST_IDENTITY_FX_PROVIDER,
      },
    },
    update: {},
    create: {
      pair: "GBPGBP",
      rate: "1",
      provider: COST_IDENTITY_FX_PROVIDER,
      captureDate: date,
      effectiveDate: date,
      fetchedAt: new Date(),
    },
  });
  return {
    id: created.id,
    pair: created.pair,
    rate: created.rate.toString(),
    provider: created.provider,
    captureDate: created.captureDate,
    effectiveDate: created.effectiveDate,
  };
}

export function formatStoredRate(rate: { toString(): string }): string {
  const parsed = parseDecimalString(rate.toString());
  return decimalToString(parsed.unscaled, parsed.scale);
}

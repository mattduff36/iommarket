import { addDecimalStrings, decimalToString, parseDecimalString, roundHalfAwayFromZero } from "@/lib/costs/money";

export const CURSOR_RATE_CARD_VERSION = "cursor-rates-2026-09-26";
export const CURSOR_RATE_CARD_SOURCE = "https://cursor.com/docs/models-and-pricing";

export interface CursorModelRate {
  id: string;
  inputUsdPerMillion: string;
  cacheWriteUsdPerMillion: string | null;
  cacheReadUsdPerMillion: string;
  outputUsdPerMillion: string;
}

/**
 * Rates checked on 26 September 2026. A dash in Cursor's cache-write column is an
 * explicit zero fee. Unknown models stay unpriced.
 */
export const CURSOR_RATE_CARD: readonly CursorModelRate[] = [
  { id: "grok-4.7", inputUsdPerMillion: "2", cacheWriteUsdPerMillion: "0", cacheReadUsdPerMillion: "0.5", outputUsdPerMillion: "6" },
  { id: "grok-4.7-fast", inputUsdPerMillion: "4", cacheWriteUsdPerMillion: "0", cacheReadUsdPerMillion: "1", outputUsdPerMillion: "12" },
  { id: "grok-4.6", inputUsdPerMillion: "2", cacheWriteUsdPerMillion: "0", cacheReadUsdPerMillion: "0.5", outputUsdPerMillion: "6" },
  { id: "grok-4.6-fast", inputUsdPerMillion: "4", cacheWriteUsdPerMillion: "0", cacheReadUsdPerMillion: "1", outputUsdPerMillion: "12" },
  { id: "composer-2.5", inputUsdPerMillion: "0.5", cacheWriteUsdPerMillion: "0", cacheReadUsdPerMillion: "0.2", outputUsdPerMillion: "2.5" },
  { id: "composer-2.5-fast", inputUsdPerMillion: "3", cacheWriteUsdPerMillion: "0", cacheReadUsdPerMillion: "0.5", outputUsdPerMillion: "15" },
  { id: "gpt-5.6-sol", inputUsdPerMillion: "4", cacheWriteUsdPerMillion: "5", cacheReadUsdPerMillion: "0.4", outputUsdPerMillion: "20" },
];

export function rateCardForModel(model: string): CursorModelRate | null {
  const normalized = model.toLowerCase();
  const fast = normalized.includes("fast");
  if (normalized.includes("grok-4.7") || normalized.includes("grok-4-7")) {
    return CURSOR_RATE_CARD.find((rate) => rate.id === (fast ? "grok-4.7-fast" : "grok-4.7")) ?? null;
  }
  if (normalized.includes("grok-4.6") || normalized.includes("grok-4-6")) {
    return CURSOR_RATE_CARD.find((rate) => rate.id === (fast ? "grok-4.6-fast" : "grok-4.6")) ?? null;
  }
  if (normalized.includes("composer")) {
    return CURSOR_RATE_CARD.find((rate) => rate.id === (fast ? "composer-2.5-fast" : "composer-2.5")) ?? null;
  }
  if (normalized.includes("gpt-5.6-sol") || normalized.includes("gpt-5-6-sol")) {
    return CURSOR_RATE_CARD.find((rate) => rate.id === "gpt-5.6-sol") ?? null;
  }
  return null;
}

function tokensTimesRate(tokens: number, usdPerMillion: string): string {
  const rate = parseDecimalString(usdPerMillion);
  const scale = Math.max(rate.scale, 6);
  const scaledProduct =
    BigInt(tokens) * rate.unscaled * BigInt(10) ** BigInt(scale - rate.scale);
  return decimalToString(roundHalfAwayFromZero(scaledProduct, BigInt(1_000_000)), scale);
}

export function nominalUsdFromTokens(input: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}): { usd: string | null; status: "calculated" | "unknown-model" | "missing-cache-write-rate" } {
  const rate = rateCardForModel(input.model);
  if (!rate) return { usd: null, status: "unknown-model" };
  if (input.cacheWriteTokens > 0 && rate.cacheWriteUsdPerMillion === null) {
    return { usd: null, status: "missing-cache-write-rate" };
  }
  const parts = [
    tokensTimesRate(input.inputTokens, rate.inputUsdPerMillion),
    tokensTimesRate(input.outputTokens, rate.outputUsdPerMillion),
    tokensTimesRate(input.cacheReadTokens, rate.cacheReadUsdPerMillion),
    tokensTimesRate(input.cacheWriteTokens, rate.cacheWriteUsdPerMillion ?? "0"),
  ];
  return { usd: addDecimalStrings(parts), status: "calculated" };
}

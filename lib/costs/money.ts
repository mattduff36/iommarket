export const COST_MARKUP_NUMERATOR = BigInt(6);
export const COST_MARKUP_DENOMINATOR = BigInt(5);
export const PENCE_PER_POUND = BigInt(100);
export const ZERO_MINOR = BigInt(0);
export const COST_POLICY_VERSION = "gbp-markup-v1";

export class CostMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CostMoneyError";
  }
}

export function parseDecimalString(value: string): { unscaled: bigint; scale: number } {
  const trimmed = value.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    throw new CostMoneyError("Amount must be a decimal number.");
  }

  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole, fraction = ""] = unsigned.split(".");
  const unscaled = BigInt(`${whole}${fraction}`);
  return {
    unscaled: negative ? -unscaled : unscaled,
    scale: fraction.length,
  };
}

export function decimalToString(unscaled: bigint, scale: number): string {
  const negative = unscaled < ZERO_MINOR;
  const digits = (negative ? -unscaled : unscaled).toString().padStart(scale + 1, "0");
  const whole = scale === 0 ? digits : digits.slice(0, -scale);
  const fraction = scale === 0 ? "" : digits.slice(-scale);
  const sign = negative ? "-" : "";
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}

export function roundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator === ZERO_MINOR) {
    throw new CostMoneyError("Cannot divide by zero.");
  }

  const negative = numerator < ZERO_MINOR !== denominator < ZERO_MINOR;
  const absNum = numerator < ZERO_MINOR ? -numerator : numerator;
  const absDen = denominator < ZERO_MINOR ? -denominator : denominator;
  const quotient = absNum / absDen;
  const remainder = absNum % absDen;
  const rounded = remainder * BigInt(2) >= absDen ? quotient + BigInt(1) : quotient;
  return negative ? -rounded : rounded;
}

/**
 * Convert a native amount and GBP-per-native rate into marked GBP pence.
 * marked = roundHalfAwayFromZero(native × rate × 6/5 × 100)
 */
export function computeMarkedGbpMinor(nativeAmount: string, gbpPerNativeRate: string): bigint {
  const native = parseDecimalString(nativeAmount);
  const rate = parseDecimalString(gbpPerNativeRate);
  const productUnscaled =
    native.unscaled * rate.unscaled * COST_MARKUP_NUMERATOR * PENCE_PER_POUND;
  const productDenominator = BigInt(10) ** BigInt(native.scale + rate.scale) * COST_MARKUP_DENOMINATOR;
  return roundHalfAwayFromZero(productUnscaled, productDenominator);
}

export function addDecimalStrings(values: readonly string[]): string {
  let maxScale = 0;
  const parsed = values.map((value) => {
    const item = parseDecimalString(value);
    maxScale = Math.max(maxScale, item.scale);
    return item;
  });
  const total = parsed.reduce((sum, item) => {
    const pad = BigInt(10) ** BigInt(maxScale - item.scale);
    return sum + item.unscaled * pad;
  }, ZERO_MINOR);
  return decimalToString(total, maxScale);
}

export function negateMinor(amount: bigint): bigint {
  return -amount;
}

export function sumMinor(amounts: readonly bigint[]): bigint {
  return amounts.reduce((total, amount) => total + amount, ZERO_MINOR);
}

export function minorToSafeNumber(amount: bigint): number {
  if (amount > BigInt(Number.MAX_SAFE_INTEGER) || amount < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new CostMoneyError("GBP amount exceeds a safe integer.");
  }
  return Number(amount);
}

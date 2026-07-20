const LOGARITHMIC_POSITION_MAX = 1_000;

function assertLogarithmicBounds(min: number, max: number): void {
  if (min <= 0 || max <= min) {
    throw new RangeError("Logarithmic ranges require 0 < min < max");
  }
}

export function valueToLogarithmicPosition(
  value: number,
  min: number,
  max: number,
): number {
  assertLogarithmicBounds(min, max);
  const boundedValue = Math.min(max, Math.max(min, value));
  const ratio = Math.log(boundedValue / min) / Math.log(max / min);
  return ratio * LOGARITHMIC_POSITION_MAX;
}

export function logarithmicPositionToValue(
  position: number,
  min: number,
  max: number,
  roundTo: number,
): number {
  assertLogarithmicBounds(min, max);
  const boundedPosition = Math.min(
    LOGARITHMIC_POSITION_MAX,
    Math.max(0, position),
  );
  if (boundedPosition === 0) return min;
  if (boundedPosition === LOGARITHMIC_POSITION_MAX) return max;

  const ratio = boundedPosition / LOGARITHMIC_POSITION_MAX;
  const value = min * Math.pow(max / min, ratio);
  const roundedValue = Math.round(value / roundTo) * roundTo;
  return Math.min(max, Math.max(min, roundedValue));
}

export { LOGARITHMIC_POSITION_MAX };

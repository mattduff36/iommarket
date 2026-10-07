export const ENGINE_SIZE_MAX_LITRES = 10;
export const ENGINE_SIZE_SLIDER_TENTHS_PER_LITRE = 10;
export const ENGINE_SIZE_SLIDER_MAX = ENGINE_SIZE_MAX_LITRES * ENGINE_SIZE_SLIDER_TENTHS_PER_LITRE;

export const CHARGING_TIME_MAX_HOURS = 168;
export const CHARGING_TIME_MINUTES_PER_HOUR = 60;
export const CHARGING_TIME_SLIDER_MAX = CHARGING_TIME_MAX_HOURS * CHARGING_TIME_MINUTES_PER_HOUR;
export const NUMERIC_FILTER_UNITS_V1 = "v1" as const;

export type NumericFilterUnitParams = {
  numericFilterUnits?: string;
  minEngineSize?: string;
  maxEngineSize?: string;
  minChargingTime?: string;
  maxChargingTime?: string;
};

function normalizeLegacyWholeValue(value: string | undefined, divisor: number) {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed) || trimmed.length > 12) return trimmed;
  const numeric = Number(trimmed);
  if (!Number.isSafeInteger(numeric)) return trimmed;
  const converted = divisor === CHARGING_TIME_MINUTES_PER_HOUR
    ? chargingTimeSliderMinutesToHours(numeric)
    : numeric / divisor;
  return String(converted);
}

/**
 * Old URLs stored engine size in tenths of litres and charge time in minutes.
 * Decimal values are already canonical and remain untouched. `v1` marks new URLs.
 */
export function normalizeNumericFilterUnits(params: NumericFilterUnitParams): NumericFilterUnitParams {
  const fields = ["minEngineSize", "maxEngineSize", "minChargingTime", "maxChargingTime"] as const;
  const hasBounds = fields.some((field) => Boolean(params[field]?.trim()));
  if (!hasBounds) {
    return { ...params, numericFilterUnits: undefined };
  }

  if (params.numericFilterUnits === NUMERIC_FILTER_UNITS_V1) {
    return { ...params, numericFilterUnits: NUMERIC_FILTER_UNITS_V1 };
  }

  if (params.numericFilterUnits) {
    return {
      ...params,
      minEngineSize: undefined,
      maxEngineSize: undefined,
      minChargingTime: undefined,
      maxChargingTime: undefined,
      numericFilterUnits: undefined,
    };
  }

  return {
    ...params,
    minEngineSize: normalizeLegacyWholeValue(params.minEngineSize, ENGINE_SIZE_SLIDER_TENTHS_PER_LITRE),
    maxEngineSize: normalizeLegacyWholeValue(params.maxEngineSize, ENGINE_SIZE_SLIDER_TENTHS_PER_LITRE),
    minChargingTime: normalizeLegacyWholeValue(params.minChargingTime, CHARGING_TIME_MINUTES_PER_HOUR),
    maxChargingTime: normalizeLegacyWholeValue(params.maxChargingTime, CHARGING_TIME_MINUTES_PER_HOUR),
    numericFilterUnits: NUMERIC_FILTER_UNITS_V1,
  };
}

export function engineSizeLitresToSlider(value: number): number {
  return value * ENGINE_SIZE_SLIDER_TENTHS_PER_LITRE;
}

export function engineSizeSliderToLitres(value: number): number {
  return value / ENGINE_SIZE_SLIDER_TENTHS_PER_LITRE;
}

export function chargingTimeHoursToSliderMinutes(value: number): number {
  return Math.round(value * CHARGING_TIME_MINUTES_PER_HOUR);
}

export function chargingTimeSliderMinutesToHours(value: number): number {
  return Number((value / CHARGING_TIME_MINUTES_PER_HOUR).toFixed(6));
}

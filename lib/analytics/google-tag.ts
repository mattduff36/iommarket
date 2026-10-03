export interface GoogleTagConfig {
  enabled: boolean;
  measurementId: string | null;
}

export function googleTagConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): GoogleTagConfig {
  const measurementId = env.GA4_MEASUREMENT_ID?.trim() ?? "";
  const validMeasurementId = /^G-[A-Z0-9]{4,20}$/.test(measurementId);
  const enabled = env.VERCEL_ENV === "production" && validMeasurementId;
  return {
    enabled,
    measurementId: enabled ? measurementId : null,
  };
}

import type { RuntimeEnv } from "@/lib/runtime-env";
import { classifyDeployment, type DeploymentClass } from "@/lib/seo/indexing-policy";

export type AdvertisingMode = "off" | "test" | "live";

export interface ProviderDestination {
  pixelId?: string;
  datasetId?: string;
  accessToken?: string;
  measurementId?: string;
  apiSecret?: string;
  adsId?: string;
  adsLabel?: string;
}

export interface AdvertisingDestination {
  mode: AdvertisingMode;
  deployment: DeploymentClass;
  reason: string;
  meta: { pixelId: string; datasetId: string; accessToken: string } | null;
  ga4: { measurementId: string; apiSecret: string } | null;
  googleAds: { id: string; label: string } | null;
}

export interface PublicAdvertisingConfig {
  enabled: boolean;
  mode: AdvertisingMode;
  metaPixelId: string | null;
  ga4MeasurementId: string | null;
  googleAdsId: string | null;
  googleAdsLabel: string | null;
}

function cleanSecret(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length < 8 || trimmed.length > 4096 || /\s/.test(trimmed)) return null;
  return trimmed;
}

function cleanMetaId(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return /^[0-9]{5,32}$/.test(trimmed) ? trimmed : null;
}

function cleanMeasurementId(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return /^G-[A-Z0-9]{4,20}$/.test(trimmed) ? trimmed : null;
}

function cleanAdsId(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return /^AW-[0-9]{6,20}$/.test(trimmed) ? trimmed : null;
}

function cleanLabel(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return /^[A-Za-z0-9_-]{4,40}$/.test(trimmed) ? trimmed : null;
}

function readMeta(env: RuntimeEnv, mode: "test" | "live") {
  const prefix = mode === "live" ? "META" : "META_TEST";
  const datasetId = cleanMetaId(env[`${prefix}_DATASET_ID`]);
  const pixelId = cleanMetaId(env[`${prefix}_PIXEL_ID`]) ?? datasetId;
  const accessToken = cleanSecret(env[`${prefix}_CAPI_ACCESS_TOKEN`]);
  if (!datasetId || !pixelId || !accessToken) return null;
  return { pixelId, datasetId, accessToken };
}

function readGa4(env: RuntimeEnv, mode: "test" | "live") {
  const prefix = mode === "live" ? "GA4" : "GA4_TEST";
  const measurementId = cleanMeasurementId(env[`${prefix}_MEASUREMENT_ID`]);
  const apiSecret = cleanSecret(env[`${prefix}_API_SECRET`]);
  if (!measurementId || !apiSecret) return null;
  return { measurementId, apiSecret };
}

function readGoogleAds(env: RuntimeEnv, mode: "test" | "live") {
  const prefix = mode === "live" ? "GOOGLE_ADS" : "GOOGLE_ADS_TEST";
  const id = cleanAdsId(env[`${prefix}_ID`]);
  const label = cleanLabel(env[`${prefix}_CONVERSION_LABEL`]);
  if (!id || !label) return null;
  return { id, label };
}

function off(deployment: DeploymentClass, reason: string): AdvertisingDestination {
  return { mode: "off", deployment, reason, meta: null, ga4: null, googleAds: null };
}

export function resolveAdvertisingDestination(
  env: RuntimeEnv = process.env,
): AdvertisingDestination {
  const deployment = classifyDeployment(env);
  const requested = env.ADVERTISING_DELIVERY?.trim();
  if (requested !== "test" && requested !== "live") return off(deployment, "disabled");
  if (requested === "live" && deployment !== "production") {
    return off(deployment, "live delivery is refused outside production");
  }
  if (requested === "live") {
    // Payment reporting currently depends on the return visit, and consent
    // cannot yet be recovered for webhook delivery. Do not let credentials
    // alone activate production conversion reporting.
    return off(deployment, "live delivery awaits durable consent and payment outcome reporting");
  }
  if (deployment === "unknown") return off(deployment, "unknown deployment cannot deliver advertising");

  const liveMeta = cleanMetaId(env.META_DATASET_ID);
  const testMeta = cleanMetaId(env.META_TEST_DATASET_ID);
  if (liveMeta && testMeta && liveMeta === testMeta) {
    return off(deployment, "test and live Meta datasets must differ");
  }
  const liveGa = cleanMeasurementId(env.GA4_MEASUREMENT_ID);
  const testGa = cleanMeasurementId(env.GA4_TEST_MEASUREMENT_ID);
  if (liveGa && testGa && liveGa === testGa) {
    return off(deployment, "test and live Google measurement ids must differ");
  }

  const meta = readMeta(env, requested);
  const ga4 = readGa4(env, requested);
  const googleAds = readGoogleAds(env, requested);
  // A configured conversion label is not a working Google Ads integration.
  // No conversion event is emitted for it yet, so do not count it as delivery.
  if (!meta && !ga4) {
    return off(deployment, googleAds ? "Google Ads conversion delivery is not implemented" : "credentials missing");
  }
  return {
    mode: requested,
    deployment,
    reason: "configured",
    meta,
    ga4,
    googleAds: null,
  };
}

export function publicAdvertisingConfig(env: RuntimeEnv = process.env): PublicAdvertisingConfig {
  const destination = resolveAdvertisingDestination(env);
  return {
    enabled: destination.mode !== "off",
    mode: destination.mode,
    metaPixelId: destination.meta?.pixelId ?? null,
    ga4MeasurementId: destination.ga4?.measurementId ?? null,
    googleAdsId: destination.googleAds?.id ?? null,
    googleAdsLabel: destination.googleAds?.label ?? null,
  };
}

export function advertisingDiagnostics(env: RuntimeEnv = process.env) {
  const destination = resolveAdvertisingDestination(env);
  return {
    deployment: destination.deployment,
    mode: destination.mode,
    reason: destination.reason,
    metaConfigured: Boolean(destination.meta),
    ga4Configured: Boolean(destination.ga4),
    googleAdsConfigured: Boolean(destination.googleAds),
    advancedMatching: false,
    tokenPresent: Boolean(
      env.META_CAPI_ACCESS_TOKEN ||
        env.META_TEST_CAPI_ACCESS_TOKEN ||
        env.GA4_API_SECRET ||
        env.GA4_TEST_API_SECRET,
    ),
  };
}

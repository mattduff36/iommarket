import { vi } from "vitest";

export const verifiedStagingEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  VERCEL_ENV: "preview",
  ITRADER_DEPLOYMENT_ROLE: "staging",
  NEXT_PUBLIC_APP_URL: "https://itrader.dev",
  NEXT_PUBLIC_SUPABASE_URL: "https://syneonzucehwlghqmfbg.supabase.co",
  DATABASE_URL: "postgres://postgres.syneonzucehwlghqmfbg:example@aws-1-eu-west-2.pooler.supabase.com:5432/postgres",
  POSTGRES_URL: "postgres://postgres.syneonzucehwlghqmfbg:example@aws-1-eu-west-2.pooler.supabase.com:5432/postgres",
  POSTGRES_URL_NON_POOLING: "postgres://postgres.syneonzucehwlghqmfbg:example@db.syneonzucehwlghqmfbg.supabase.co:5432/postgres",
};

export function stubVerifiedStaging() {
  for (const [key, value] of Object.entries(verifiedStagingEnv)) {
    if (value) vi.stubEnv(key, value);
  }
}

export function stubProductionFrontend() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("ITRADER_DEPLOYMENT_ROLE", "production");
  vi.stubEnv("ITRADER_LOCAL_STAGING_FEATURES", "");
}

import { describe, expect, it } from "vitest";
import { isStagingDeployment, isStagingOnlyFeatureEnabled } from "@/lib/deployment/environment";

const staging: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  VERCEL_ENV: "preview",
  ITRADER_DEPLOYMENT_ROLE: "staging",
  NEXT_PUBLIC_APP_URL: "https://preview.itrader.im",
  NEXT_PUBLIC_SUPABASE_URL: "https://syneonzucehwlghqmfbg.supabase.co",
  DATABASE_URL: "postgres://postgres.syneonzucehwlghqmfbg:example@aws-1-eu-west-2.pooler.supabase.com:5432/postgres",
};

describe("staging-only deployment guard", () => {
  it("requires every hosted staging identity and data target", () => {
    expect(isStagingDeployment(staging)).toBe(true);
    expect(isStagingDeployment({ ...staging, VERCEL_ENV: "production" })).toBe(false);
    expect(isStagingDeployment({ ...staging, NEXT_PUBLIC_APP_URL: "https://itrader.im" })).toBe(false);
    expect(isStagingDeployment({ ...staging, NEXT_PUBLIC_SUPABASE_URL: "https://snlqivvogfqesxpbjiei.supabase.co" })).toBe(false);
    expect(isStagingDeployment({ ...staging, POSTGRES_URL: "postgres://postgres.snlqivvogfqesxpbjiei:example@aws-1-eu-west-2.pooler.supabase.com:5432/postgres" })).toBe(false);
  });

  it("allows local feature testing only with explicit opt-in and preview data", () => {
    const local: NodeJS.ProcessEnv = {
      ...staging,
      NODE_ENV: "development",
      VERCEL_ENV: undefined,
      ITRADER_LOCAL_STAGING_FEATURES: "1",
    };
    expect(isStagingOnlyFeatureEnabled(local)).toBe(true);
    expect(isStagingOnlyFeatureEnabled({ ...local, ITRADER_LOCAL_STAGING_FEATURES: "0" })).toBe(false);
    expect(isStagingOnlyFeatureEnabled({ ...local, DATABASE_URL: "postgres://postgres.snlqivvogfqesxpbjiei:example@aws-1-eu-west-2.pooler.supabase.com:5432/postgres" })).toBe(false);
  });
});

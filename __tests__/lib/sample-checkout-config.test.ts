import { describe, expect, it } from "vitest";
import { isSampleCheckoutEnabled, SAMPLE_MAX_ATTEMPTS } from "@/lib/payments/sample-checkout-config";

const previewEnv = {
  NODE_ENV: "production",
  VERCEL_ENV: "preview",
  POSTGRES_URL: "postgresql://postgres:secret@db.syneonzucehwlghqmfbg.supabase.co:5432/postgres",
} as NodeJS.ProcessEnv;

describe("sample checkout environment gate", () => {
  it("requires both a preview deployment and the dedicated project database", () => {
    expect(isSampleCheckoutEnabled(previewEnv)).toBe(true);
    expect(isSampleCheckoutEnabled({ ...previewEnv, VERCEL_ENV: "production" })).toBe(false);
    expect(isSampleCheckoutEnabled({ ...previewEnv, VERCEL_ENV: "development" })).toBe(false);
    expect(isSampleCheckoutEnabled({ ...previewEnv, POSTGRES_URL: "postgresql://u:p@other.supabase.co/db" })).toBe(false);
  });

  it("rejects forged simulator flags and malformed or unrelated database URLs", () => {
    expect(isSampleCheckoutEnabled({
      NODE_ENV: "production", VERCEL_ENV: "production", RIPPLE_SAMPLE_CHECKOUT_ENABLED: "1", POSTGRES_URL: previewEnv.POSTGRES_URL,
    } as NodeJS.ProcessEnv)).toBe(false);
    expect(isSampleCheckoutEnabled({ NODE_ENV: "production", VERCEL_ENV: "preview", POSTGRES_URL: "not a url" })).toBe(false);
    expect(isSampleCheckoutEnabled({ NODE_ENV: "production", VERCEL_ENV: "preview" })).toBe(false);
    expect(isSampleCheckoutEnabled({
      NODE_ENV: "production",
      VERCEL_ENV: "preview", POSTGRES_URL: "postgresql://postgres.other:secret@other.pooler.supabase.com/db",
    })).toBe(false);
  });

  it("recognizes the project-specific pooler identity and caps attempts at three", () => {
    expect(isSampleCheckoutEnabled({
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      POSTGRES_URL: "postgresql://postgres.syneonzucehwlghqmfbg:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres",
    })).toBe(true);
    expect(SAMPLE_MAX_ATTEMPTS).toBe(3);
  });
});

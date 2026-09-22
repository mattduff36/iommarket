import { describe, expect, it } from "vitest";
import {
  assertPreviewSeedEnvFile,
  assertPreviewSeedTarget,
  choosePreviewSeedConnectionString,
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
} from "../../scripts/seed-preview-marketplace/target";

const previewDirect = "postgresql://postgres:x@db.syneonzucehwlghqmfbg.supabase.co:5432/postgres";
const previewSupabase = "https://syneonzucehwlghqmfbg.supabase.co";
const productionDirect = "postgresql://postgres:x@db.snlqivvogfqesxpbjiei.supabase.co:5432/postgres";
const productionSupabase = "https://snlqivvogfqesxpbjiei.supabase.co";

describe("PREVIEW-TARGET-001 SEED-PREVIEW-001 preview seed refuses production", () => {
  it("accepts the preview project and refuses production refs", () => {
    expect(() =>
      assertPreviewSeedTarget({
        databaseUrl: previewDirect,
        supabaseUrl: previewSupabase,
      }),
    ).not.toThrow();
    expect(
      choosePreviewSeedConnectionString({
        databaseUrl: previewDirect,
        supabaseUrl: previewSupabase,
      }),
    ).toBe(previewDirect);
    expect(PREVIEW_PROJECT_REF).toBe("syneonzucehwlghqmfbg");
    expect(PRODUCTION_PROJECT_REF).toBe("snlqivvogfqesxpbjiei");
  });

  it("refuses .env.production and mixed production URLs", () => {
    expect(() => assertPreviewSeedEnvFile(".env.production")).toThrow(".env.production");
    expect(() =>
      assertPreviewSeedTarget({
        databaseUrl: previewDirect,
        supabaseUrl: productionSupabase,
      }),
    ).toThrow("NEXT_PUBLIC_SUPABASE_URL");
    expect(() =>
      assertPreviewSeedTarget({
        databaseUrl: productionDirect,
        supabaseUrl: previewSupabase,
      }),
    ).toThrow("production project ref");
  });

  it("rejects loopback, malformed, and non-preview database targets", () => {
    expect(() =>
      assertPreviewSeedTarget({
        databaseUrl: "postgresql://postgres:x@127.0.0.1:5432/postgres",
        supabaseUrl: previewSupabase,
      }),
    ).toThrow("database URL is not the preview project");
    expect(() =>
      assertPreviewSeedTarget({
        databaseUrl: "postgresql://postgres:x@localhost:5432/postgres",
        supabaseUrl: previewSupabase,
      }),
    ).toThrow("database URL is not the preview project");
    expect(() =>
      assertPreviewSeedTarget({
        databaseUrl: "not-a-url",
        supabaseUrl: previewSupabase,
      }),
    ).toThrow("database URL is not the preview project");
    expect(() =>
      assertPreviewSeedTarget({
        supabaseUrl: previewSupabase,
      }),
    ).toThrow("missing DATABASE_URL");
  });
});

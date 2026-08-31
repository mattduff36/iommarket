import { describe, expect, it } from "vitest";
import { buildDirectDatabaseUrl } from "../../scripts/prod-mirror/env";
import {
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
} from "../../scripts/prod-mirror/constants";
import {
  assertRestoreNotPooler,
  assertSourceAndDestRefs,
  chooseRestoreConnectionString,
  chooseWaitlistWriteConnectionString,
  isAllowedPreviewDatabaseUrl,
  isAllowedProductionDatabaseUrl,
  isAllowedRestoreDatabaseUrl,
  isAllowedSupabaseApiUrl,
  isAllowedWaitlistWriteDatabaseUrl,
} from "../../scripts/prod-mirror/target";

const previewDirect = "postgresql://postgres:x@db.syneonzucehwlghqmfbg.supabase.co:5432/postgres";
const previewPooler =
  "postgresql://postgres.syneonzucehwlghqmfbg:x@aws-0-eu-west-2.pooler.supabase.com:5432/postgres";
const productionDirect = "postgresql://postgres:x@db.snlqivvogfqesxpbjiei.supabase.co:5432/postgres";
const productionPooler =
  "postgresql://postgres.snlqivvogfqesxpbjiei:x@aws-1-eu-west-2.pooler.supabase.com:6543/postgres";
const previewSupabase = "https://syneonzucehwlghqmfbg.supabase.co";
const productionSupabase = "https://snlqivvogfqesxpbjiei.supabase.co";

describe("PMR-HOST-001 restore/write allowlists pin exact Supabase refs", () => {
  it("accepts preview waitlist writes on preview direct and preview pooler user", () => {
    expect(isAllowedWaitlistWriteDatabaseUrl(previewDirect)).toBe(true);
    expect(isAllowedWaitlistWriteDatabaseUrl(previewPooler)).toBe(true);
    expect(chooseWaitlistWriteConnectionString([previewPooler])).toBe(previewPooler);
    expect(chooseWaitlistWriteConnectionString([previewPooler, previewDirect])).toBe(previewDirect);
    expect(isAllowedSupabaseApiUrl(previewSupabase, PREVIEW_PROJECT_REF)).toBe(true);
    expect(isAllowedSupabaseApiUrl(productionSupabase, PRODUCTION_PROJECT_REF)).toBe(true);
  });

  it("accepts production restore only on the production direct host", () => {
    expect(isAllowedRestoreDatabaseUrl(productionDirect)).toBe(true);
    expect(chooseRestoreConnectionString([productionPooler, productionDirect])).toBe(
      productionDirect,
    );
    expect(isAllowedProductionDatabaseUrl(productionDirect, false)).toBe(true);
    expect(isAllowedPreviewDatabaseUrl(previewDirect, false)).toBe(true);
    const built = buildDirectDatabaseUrl({
      host: "db.snlqivvogfqesxpbjiei.supabase.co",
      user: "postgres",
      password: "secret",
      database: "postgres",
    });
    expect(isAllowedRestoreDatabaseUrl(built)).toBe(true);
  });
});

describe("PMR-HOST-002 mixed, equal, local, restore-pooler, and unknown refs", () => {
  it("rejects equal or swapped source/dest refs", () => {
    expect(() => assertSourceAndDestRefs(PREVIEW_PROJECT_REF, PREVIEW_PROJECT_REF)).toThrow(
      "must not be equal",
    );
    expect(() => assertSourceAndDestRefs(PRODUCTION_PROJECT_REF, PREVIEW_PROJECT_REF)).toThrow(
      "SOURCE_REF",
    );
    expect(() => assertSourceAndDestRefs(PREVIEW_PROJECT_REF, "other")).toThrow("DEST_REF");
  });

  it("rejects localhost, unknown hosts, and mixed project URLs", () => {
    expect(isAllowedWaitlistWriteDatabaseUrl("postgresql://postgres:x@localhost:5432/postgres")).toBe(
      false,
    );
    expect(isAllowedRestoreDatabaseUrl("postgresql://postgres:x@127.0.0.1:5432/postgres")).toBe(
      false,
    );
    expect(isAllowedWaitlistWriteDatabaseUrl(productionDirect)).toBe(false);
    expect(isAllowedRestoreDatabaseUrl(previewDirect)).toBe(false);
    expect(isAllowedSupabaseApiUrl(productionSupabase, PREVIEW_PROJECT_REF)).toBe(false);
    expect(isAllowedSupabaseApiUrl(previewSupabase, PRODUCTION_PROJECT_REF)).toBe(false);
    expect(
      isAllowedWaitlistWriteDatabaseUrl(
        "postgresql://postgres.syneonzucehwlghqmfbg:x@example.com:5432/postgres",
      ),
    ).toBe(false);
  });

  it("rejects pooler URLs for restore", () => {
    expect(isAllowedRestoreDatabaseUrl(productionPooler)).toBe(false);
    expect(() => chooseRestoreConnectionString([productionPooler])).toThrow("non-pooling");
    expect(() => assertRestoreNotPooler(productionPooler)).toThrow("pooler");
  });
});

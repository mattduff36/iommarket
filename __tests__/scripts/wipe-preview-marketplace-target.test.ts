import { describe, expect, it } from "vitest";
import {
  DELETE_AUTH_EMAILS,
  EXPECTED_KEPT_DEALER_NAMES,
  KEEP_ACCOUNT_EMAILS,
  PREVIEW_DB_HOST,
  PREVIEW_POOLER_USER,
  PREVIEW_SUPABASE_HOST,
  PRODUCTION_PROJECT_REF,
  assertKeptDealerProfiles,
  assertKeptEmails,
  assertPreflightAuthRoster,
  assertPreflightKeptDealers,
  assertPreserveCountsUnchanged,
  assertPreviewWipePreflight,
  assertPreviewWipeTarget,
  chooseWipeConnectionString,
  isAllowedPreviewDatabaseUrl,
  isAllowedPreviewSupabaseUrl,
  resolvePreservedUserIds,
} from "../../scripts/wipe-preview-marketplace/target";

const APPROVED_KEEP_EMAILS = [
  "admin@mpdee.co.uk",
  "d.p.marshall@hotmail.co.uk",
] as const;
const APPROVED_DELETE_EMAILS = [
  "davooomarsh@hotmail.com",
  "mattduff36@gmail.com",
] as const;
const APPROVED_DEALER_NAMES = [] as const;

const previewDirect = "postgresql://postgres:x@db.syneonzucehwlghqmfbg.supabase.co:5432/postgres";
const previewPooler =
  "postgresql://postgres.syneonzucehwlghqmfbg:x@aws-0-eu-west-2.pooler.supabase.com:5432/postgres";
const previewSupabase = "https://syneonzucehwlghqmfbg.supabase.co";
const productionDirect = "postgresql://postgres:x@db.snlqivvogfqesxpbjiei.supabase.co:5432/postgres";
const productionPooler =
  "postgresql://postgres.snlqivvogfqesxpbjiei:x@aws-1-eu-west-2.pooler.supabase.com:6543/postgres";
const productionSupabase = "https://snlqivvogfqesxpbjiei.supabase.co";

describe("WPE-HOST-001 preview wipe host allowlist", () => {
  it("accepts only the new-ford-dealership direct database host", () => {
    expect(isAllowedPreviewDatabaseUrl(previewDirect)).toBe(true);
    expect(isAllowedPreviewDatabaseUrl(productionDirect)).toBe(false);
    expect(isAllowedPreviewDatabaseUrl("postgresql://postgres:x@localhost:5432/postgres")).toBe(
      false,
    );
    expect(isAllowedPreviewDatabaseUrl("postgresql://postgres:x@127.0.0.1:5432/postgres")).toBe(
      false,
    );
  });

  it("accepts the preview pooler only when the username is the preview ref", () => {
    expect(isAllowedPreviewDatabaseUrl(previewPooler)).toBe(true);
    expect(isAllowedPreviewDatabaseUrl(productionPooler)).toBe(false);
    expect(
      isAllowedPreviewDatabaseUrl(
        "postgresql://postgres.syneonzucehwlghqmfbg:x@aws-1-eu-west-2.pooler.supabase.com:5432/postgres",
      ),
    ).toBe(true);
    expect(
      isAllowedPreviewDatabaseUrl(
        `postgresql://postgres.${PRODUCTION_PROJECT_REF}:x@aws-0-eu-west-2.pooler.supabase.com:5432/postgres`,
      ),
    ).toBe(false);
  });

  it("rejects production Supabase URL and mixed production database URLs", () => {
    expect(() =>
      assertPreviewWipeTarget({
        databaseUrl: previewDirect,
        supabaseUrl: productionSupabase,
      }),
    ).toThrow("NEXT_PUBLIC_SUPABASE_URL");
    expect(() =>
      assertPreviewWipeTarget({
        databaseUrl: productionDirect,
        supabaseUrl: previewSupabase,
      }),
    ).toThrow("not the new-ford-dealership preview");
    expect(() =>
      assertPreviewWipeTarget({
        databaseUrl: previewDirect,
        postgresUrlNonPooling: productionPooler,
        supabaseUrl: previewSupabase,
      }),
    ).toThrow("not the new-ford-dealership preview");
  });

  it("requires https and the default port for the preview Supabase URL", () => {
    expect(isAllowedPreviewSupabaseUrl(previewSupabase)).toBe(true);
    expect(isAllowedPreviewSupabaseUrl("http://syneonzucehwlghqmfbg.supabase.co")).toBe(false);
    expect(isAllowedPreviewSupabaseUrl("https://syneonzucehwlghqmfbg.supabase.co:8443")).toBe(
      false,
    );
    expect(isAllowedPreviewSupabaseUrl(productionSupabase)).toBe(false);
    expect(PREVIEW_SUPABASE_HOST).toBe("syneonzucehwlghqmfbg.supabase.co");
    expect(PREVIEW_DB_HOST).toBe("db.syneonzucehwlghqmfbg.supabase.co");
    expect(PREVIEW_POOLER_USER).toBe("postgres.syneonzucehwlghqmfbg");
    expect(PRODUCTION_PROJECT_REF).toBe("snlqivvogfqesxpbjiei");
  });

  it("prefers the preview direct DATABASE_URL for the wipe connection", () => {
    expect(
      chooseWipeConnectionString({
        databaseUrl: previewDirect,
        postgresUrlNonPooling: previewPooler,
        supabaseUrl: previewSupabase,
      }),
    ).toBe(previewDirect);
  });

  it("pins the approved keep/delete emails and dealer names before any mutation", () => {
    expect([...KEEP_ACCOUNT_EMAILS]).toEqual([...APPROVED_KEEP_EMAILS]);
    expect([...DELETE_AUTH_EMAILS]).toEqual([...APPROVED_DELETE_EMAILS]);
    expect([...EXPECTED_KEPT_DEALER_NAMES]).toEqual([...APPROVED_DEALER_NAMES]);

    const users = APPROVED_KEEP_EMAILS.map((email, index) => ({
      id: `user-${index}`,
      email,
    }));
    expect(resolvePreservedUserIds(users)).toEqual(["user-0", "user-1"]);
    expect(() => resolvePreservedUserIds(users.slice(1))).toThrow("Keep-list users missing");

    expect(() =>
      assertPreflightAuthRoster([...APPROVED_KEEP_EMAILS]),
    ).not.toThrow();
    expect(() =>
      assertPreflightAuthRoster([...APPROVED_KEEP_EMAILS, ...APPROVED_DELETE_EMAILS]),
    ).not.toThrow();

    expect(() =>
      assertPreflightKeptDealers([
        { name: "Morris motors", ownerEmail: "d.p.marshall@hotmail.co.uk" },
      ]),
    ).toThrow("Kept dealer ownership mismatch");
    expect(() => assertPreflightKeptDealers([])).not.toThrow();
    expect(
      assertPreviewWipePreflight({
        users: [
          ...APPROVED_KEEP_EMAILS.map((email, index) => ({
            id: `user-${index}`,
            email,
            dealerName: email === "d.p.marshall@hotmail.co.uk" ? "Morris motors" : "Admin (mpdee)",
          })),
          {
            id: "user-ocean",
            email: "mattduff36@gmail.com",
            dealerName: "Ocean Motor Village",
          },
        ],
        authUsers: [
          ...APPROVED_KEEP_EMAILS.map((email, index) => ({ id: `auth-${index}`, email })),
          ...APPROVED_DELETE_EMAILS.map((email, index) => ({
            id: `auth-del-${index}`,
            email,
          })),
        ],
      }).preservedUserIds,
    ).toEqual(["user-0", "user-1"]);
    expect(() =>
      assertPreviewWipePreflight({
        users: APPROVED_KEEP_EMAILS.map((email, index) => ({
          id: `user-${index}`,
          email,
        })),
        authUsers: [
          ...APPROVED_KEEP_EMAILS.map((email, index) => ({ id: `auth-${index}`, email })),
          { id: "auth-phone", email: null },
        ],
      }),
    ).toThrow("Kept emails mismatch");

    expect(() =>
      assertKeptEmails(["admin@mpdee.co.uk", "other@example.com"]),
    ).toThrow("Kept emails mismatch");
    expect(() =>
      assertKeptDealerProfiles([{ name: "Morris motors" }]),
    ).toThrow("Kept dealer profiles mismatch");
    expect(() =>
      assertPreserveCountsUnchanged(
        { waitlistUsers: 10, siteSettings: 6, regions: 6, categories: 4, costEntries: 9 },
        { waitlistUsers: 9, siteSettings: 6, regions: 6, categories: 4, costEntries: 9 },
      ),
    ).toThrow("Preserved waitlistUsers changed");
  });
});

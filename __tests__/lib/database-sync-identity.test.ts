import { describe, expect, it } from "vitest";
import {
  foreignKeyParents,
  indexIdentityLinks,
  reconcileIdentities,
  remapRows,
  type DealerIdentity,
  type IdentitySnapshot,
  type PackIdentity,
  type PolicyIdentity,
  type UserIdentity,
} from "@/lib/database-sync/identity-reconcile";

function user(overrides: Partial<UserIdentity> & Pick<UserIdentity, "id" | "email" | "authUserId">): UserIdentity {
  return { role: "DEALER", disabled: false, deleted: false, ...overrides };
}

function dealer(overrides: Partial<DealerIdentity> & Pick<DealerIdentity, "id" | "userId" | "slug">): DealerIdentity {
  return { preview: true, ...overrides };
}

function pack(id: string, dealerKey: string, dealerProfileId: string): PackIdentity {
  return { id, dealerKey, dealerProfileId };
}

function policy(id: string, userId: string, payload = "same"): PolicyIdentity {
  return { id, userId, acceptanceType: "TERMS", bundleVersion: "2026-01", payload, source: "SIGNUP" };
}

function snapshot(partial: Partial<IdentitySnapshot>): IdentitySnapshot {
  return {
    users: { source: [], destination: [] },
    dealers: { source: [], destination: [] },
    packs: { source: [], destination: [] },
    policies: { source: [], destination: [] },
    waitlist: { source: [], destination: [] },
    issues: { source: [], destination: [] },
    promotions: { source: [], destination: [] },
    ...partial,
  };
}

describe("database sync identity reconciliation", () => {
  it("maps a user only when email and auth subject are the same development user, then maps the dealer chain", () => {
    const result = reconcileIdentities(snapshot({
      users: {
        source: [user({ id: "source-user", email: "dealer@example.com", authUserId: "auth-1" })],
        destination: [user({ id: "dest-user", email: "dealer@example.com", authUserId: "auth-1" })],
      },
      dealers: {
        source: [dealer({ id: "source-dealer", userId: "source-user", slug: "island-motors" })],
        destination: [dealer({ id: "dest-dealer", userId: "dest-user", slug: "island-motors" })],
      },
      packs: {
        source: [pack("source-pack", "island-motors", "source-dealer")],
        destination: [pack("dest-pack", "island-motors", "dest-dealer")],
      },
      policies: {
        source: [policy("source-policy", "kept-user")],
        destination: [policy("dest-policy", "kept-user")],
      },
    }));

    expect(result.blockers).toEqual([]);
    expect(result.links).toEqual([
      { table: "User", sourceId: "source-user", destinationId: "dest-user" },
      { table: "DealerProfile", sourceId: "source-dealer", destinationId: "dest-dealer" },
      { table: "DealerPreviewPack", sourceId: "source-pack", destinationId: "dest-pack" },
      { table: "PolicyAcceptance", sourceId: "source-policy", destinationId: "dest-policy" },
    ]);
    expect(result.notes.map((note) => note.split(" ")[0])).toEqual(["1", "1", "1", "1"]);
  });

  it("does not merge a user from email alone, or when email and auth point at different users", () => {
    const emailOnly = reconcileIdentities(snapshot({
      users: {
        source: [user({ id: "source-user", email: "shared@example.com", authUserId: "auth-source", role: "USER" })],
        destination: [user({ id: "dest-user", email: "shared@example.com", authUserId: "auth-dest", role: "USER" })],
      },
    }));
    expect(emailOnly.links).toEqual([]);
    expect(emailOnly.blockers).toEqual([
      "User source-user matches development user dest-user by email only. Auth subjects differ, so these users were not merged.",
    ]);
    expect(emailOnly.blockers.join(" ")).not.toContain("shared@example.com");

    const split = reconcileIdentities(snapshot({
      users: {
        source: [user({ id: "source-user", email: "one@example.com", authUserId: "auth-b" })],
        destination: [
          user({ id: "email-user", email: "one@example.com", authUserId: "auth-a" }),
          user({ id: "auth-user", email: "other@example.com", authUserId: "auth-b" }),
        ],
      },
    }));
    expect(split.links).toEqual([]);
    expect(split.blockers[0]).toContain("different development users");
    expect(split.blockers.join(" ")).not.toContain("one@example.com");
  });

  it("keeps a shared primary key whose production email belongs to someone else", () => {
    const result = reconcileIdentities(snapshot({
      users: {
        source: [user({ id: "shared-user", email: "production@example.com", authUserId: "auth-prod", role: "USER" })],
        destination: [
          user({ id: "shared-user", email: "development@example.com", authUserId: "auth-dev", role: "USER" }),
          user({ id: "other-user", email: "production@example.com", authUserId: "auth-other", role: "USER" }),
        ],
      },
    }));
    expect(result.links).toEqual([]);
    expect(result.blockers).toEqual([
      "User shared-user already exists in development, but its production email belongs to development user other-user and the auth subjects differ.",
    ]);
    expect(result.blockers.join(" ")).not.toContain("production@example.com");
  });

  it("does not map administrators, disabled users, role changes, or a dealer slug without the linked user", () => {
    const admin = reconcileIdentities(snapshot({
      users: {
        source: [user({ id: "source-admin", email: "admin@example.com", authUserId: "auth-admin", role: "ADMIN" })],
        destination: [user({ id: "dest-admin", email: "admin@example.com", authUserId: "auth-admin", role: "ADMIN" })],
      },
    }));
    expect(admin.links).toEqual([]);
    expect(admin.blockers[0]).toContain("administrator");

    const disabled = reconcileIdentities(snapshot({
      users: {
        source: [user({ id: "source-user", email: "dealer@example.com", authUserId: "auth-1", disabled: true })],
        destination: [user({ id: "dest-user", email: "dealer@example.com", authUserId: "auth-1" })],
      },
    }));
    expect(disabled.links).toEqual([]);
    expect(disabled.blockers[0]).toContain("disabled or deleted");

    const slugOnly = reconcileIdentities(snapshot({
      users: {
        source: [user({ id: "source-user", email: "a@example.com", authUserId: "auth-a" })],
        destination: [user({ id: "dest-user", email: "b@example.com", authUserId: "auth-b" })],
      },
      dealers: {
        source: [dealer({ id: "source-dealer", userId: "source-user", slug: "shared-slug" })],
        destination: [dealer({ id: "dest-dealer", userId: "dest-user", slug: "shared-slug" })],
      },
    }));
    expect(slugOnly.links).toEqual([]);
    expect(slugOnly.blockers.some((blocker) => blocker.includes("DealerProfile source-dealer") && blocker.includes("not the same email and auth identity"))).toBe(true);

    const previewFlag = reconcileIdentities(snapshot({
      users: {
        source: [user({ id: "source-user", email: "dealer@example.com", authUserId: "auth-1" })],
        destination: [user({ id: "dest-user", email: "dealer@example.com", authUserId: "auth-1" })],
      },
      dealers: {
        source: [dealer({ id: "source-dealer", userId: "source-user", slug: "island-motors", preview: true })],
        destination: [dealer({ id: "dest-dealer", userId: "dest-user", slug: "island-motors", preview: false })],
      },
    }));
    expect(previewFlag.links.map((link) => link.table)).toEqual(["User"]);
    expect(previewFlag.blockers[0]).toContain("preview flags differ");
  });

  it("blocks differing consent and operational state instead of treating the natural key as enough", () => {
    const result = reconcileIdentities(snapshot({
      policies: {
        source: [policy("source-policy", "user-1", "production-consent")],
        destination: [policy("dest-policy", "user-1", "development-consent")],
      },
      waitlist: {
        source: [{ id: "source-campaign", naturalKey: "launch", fields: { status: "SENT", recipientTotal: "10", sentCount: "10", failedCount: "0", skippedCount: "0", body: "same-body" } }],
        destination: [{ id: "dest-campaign", naturalKey: "launch", fields: { status: "DRAFT", recipientTotal: "0", sentCount: "0", failedCount: "0", skippedCount: "0", body: "same-body" } }],
      },
      issues: {
        source: [{ id: "source-issue", naturalKey: "fingerprint-a", fields: { status: "OPEN", severity: "HIGH", source: "WEB", occurrences: "4" } }],
        destination: [{ id: "dest-issue", naturalKey: "fingerprint-a", fields: { status: "RESOLVED", severity: "LOW", source: "WEB", occurrences: "1" } }],
      },
      promotions: {
        source: [{ id: "source-promo", naturalKey: "spring", fields: { timezone: "Europe/London", startsAt: "2026-03-01", endsAt: "2026-04-01", tier: "PRO" } }],
        destination: [{ id: "dest-promo", naturalKey: "spring", fields: { timezone: "Europe/London", startsAt: "2026-05-01", endsAt: "2026-06-01", tier: "PRO" } }],
      },
    }));
    expect(result.links).toEqual([]);
    expect(result.blockers).toEqual([
      "DealerPromotionCampaign source-promo matches development dest-promo on its natural key, but starts at and ends at differ.",
      "MonitoringIssue source-issue matches development dest-issue on its natural key, but status, severity, and occurrences differ.",
      "PolicyAcceptance source-policy matches development dest-policy for the same user, acceptance type, and bundle version, but the recorded consent differs.",
      "WaitlistEarlyAccessCampaign source-campaign matches development dest-campaign on its natural key, but status, recipient total, and sent count differ.",
    ]);
    expect(result.blockers.join(" ")).not.toContain("production-consent");
    expect(result.blockers.join(" ")).not.toContain("fingerprint-a");
  });

  it("rewrites primary keys and foreign keys without changing unrelated values", () => {
    const links = indexIdentityLinks([
      { table: "User", sourceId: "source-user", destinationId: "dest-user" },
      { table: "DealerProfile", sourceId: "source-dealer", destinationId: "dest-dealer" },
      { table: "DealerPreviewPack", sourceId: "source-pack", destinationId: "dest-pack" },
    ]);
    const parents = foreignKeyParents([
      { child: "DealerProfile", parent: "User", childColumns: ["userId"] },
      { child: "Listing", parent: "User", childColumns: ["userId"] },
      { child: "Listing", parent: "DealerProfile", childColumns: ["dealerId"] },
      { child: "Listing", parent: "DealerPreviewPack", childColumns: ["previewPackId"] },
    ]);
    expect(remapRows("DealerProfile", "id", [{ name: "id" }, { name: "userId" }, { name: "slug" }], [["source-dealer", "source-user", "island-motors"]], links, parents)).toEqual([
      ["dest-dealer", "dest-user", "island-motors"],
    ]);
    expect(remapRows("Listing", "id", [{ name: "id" }, { name: "userId" }, { name: "dealerId" }, { name: "previewPackId" }], [["listing-1", "source-user", "source-dealer", "source-pack"]], links, parents)).toEqual([
      ["listing-1", "dest-user", "dest-dealer", "dest-pack"],
    ]);
    expect(remapRows("Listing", "id", [{ name: "id" }, { name: "userId" }], [["listing-2", null]], links, parents)).toEqual([["listing-2", null]]);
  });
});

import { describe, expect, it, vi } from "vitest";
import { scrubAuthUser, scrubIdentity, adminIdentityCollision, authScrubViolations, preservedAuthCollision } from "@/lib/database-sync/auth-clone";
import { loadCloneCatalog, loadPrismaSchema, parsePrismaCatalog } from "@/lib/database-sync/catalog";
import { excludedSyncTable } from "@/lib/database-sync/scope-policy";
import { canonicalBytes, hashCanonical, parseCanonical, restoreValueExpression } from "@/lib/database-sync/codec";
import { openChunk, sealChunk } from "@/lib/database-sync/chunks";
import { SCHEMA_FINGERPRINT_SQL, hashSchemaLines, schemaCompatibility } from "@/lib/database-sync/fingerprint";
import { lockCloneTablesSql, APPLY_DEADLINE_MS, APPLY_STATEMENT_TIMEOUT, CLONE_PAGE_SIZE } from "@/lib/database-sync/clone-engine";
import { externalEffectBlocked } from "@/lib/database-sync/effects";
import { planCloneOrder } from "@/lib/database-sync/order";
import { BACKUP_BUDGET_BYTES, BACKUP_TTL_MS, planBackupRetention, type BackupPoint } from "@/lib/database-sync/retention";
import { isTransactionPoolerUrl, resolvePreviewSessionUrl } from "@/lib/database-sync/session";

const schema = `
enum Role {
  ADMIN
  USER
}

model Region {
  id String @id
  name String
}

model Listing {
  id String @id
  featured Boolean @default(false)
  viewCount Int
}

model Payment {
  id String @id
  providerPaymentId String?
}

model User {
  id String @id
  email String
}
`;

describe("ARCH-CLONE-001 schema completeness", () => {
  it("keeps featured, payments and every parsed model", () => {
    const catalog = parsePrismaCatalog(schema);
    expect(catalog.map((table) => table.name)).toEqual(["Region", "Listing", "Payment", "User"]);
    expect(catalog.find((table) => table.name === "Listing")?.columns.map((column) => column.name)).toContain("featured");
    expect(catalog.find((table) => table.name === "Payment")?.columns.map((column) => column.name)).toContain("providerPaymentId");
  });

  it("fails if the live schema drops Listing.featured, Payment or Subscription", () => {
    const catalog = loadCloneCatalog();
    const included = parsePrismaCatalog(loadPrismaSchema()).filter((table) => !excludedSyncTable(table.name));
    expect(catalog.map((table) => table.name)).toEqual(included.map((table) => table.name));
    expect(catalog.length).toBeGreaterThan(40);
    expect(catalog.find((table) => table.name === "Listing")?.columns.map((column) => column.name)).toContain("featured");
    expect(catalog.some((table) => table.name === "Payment")).toBe(true);
    expect(catalog.some((table) => table.name === "Subscription")).toBe(true);
    expect(catalog.every((table) => table.primaryKey && table.columns.length > 0)).toBe(true);
  });
});

describe("ARCH-CLONE-002 lossless codec and fingerprint", () => {
  it("casts PostgreSQL internal char fields before fingerprint concatenation", () => {
    expect(SCHEMA_FINGERPRINT_SQL).toContain("f.contype::text");
    expect(SCHEMA_FINGERPRINT_SQL).not.toContain("f.contype ||");
  });

  it("round-trips featured and numeric text without JSON number coercion", () => {
    const bytes = canonicalBytes("Listing", [{ name: "featured", type: "boolean" }, { name: "markedGbpMinor", type: "bigint" }], [["true", "9007199254740993"]]);
    expect(parseCanonical(bytes).rows).toEqual([["true", "9007199254740993"]]);
    expect(hashCanonical(bytes)).toHaveLength(64);
    expect(restoreValueExpression("character varying(255)", 0)).toContain("CAST");
    expect(hashSchemaLines(["b", "a"])).toBe(hashSchemaLines(["a", "b"]));
  });

  it("ignores migration checksum bytes and still blocks a real column change", () => {
    const production = [
      "column|public|User|id|uuid|true|-1|",
      "constraint|public|User|User_pkey|p|PRIMARY KEY (id)|false|false",
      "migration|20260929213000_signup_rate_limit|8e0ea07ee41a42a306888ba2e42a2b7ea23653be597e43c925e97078944cae94",
      "migration|20260930200000_preview_review_metadata|5daedeb41f5b97e79dbb4173351468e53ab87114a5e6ca89073cf35211e923c2",
    ];
    const development = [
      production[0],
      production[1],
      "migration|20260929213000_signup_rate_limit|ba8cad568a90f446450ad3d25bc850c404317b861875f28c4eae83946918f99b",
      "migration|20260930200000_preview_review_metadata|aa54297ba0b2c50f6b0f8410d8713c839c78bbe0230788b16479982cf33db91c",
    ];
    expect(schemaCompatibility(production, development)).toEqual({
      schemaCompatible: true,
      migrationsCompatible: true,
      blockers: [],
    });

    const drifted = schemaCompatibility(
      [...production, "column|public|Category|merge_probe|text|false|-1|"],
      development,
    );
    expect(drifted.schemaCompatible).toBe(false);
    expect(drifted.migrationsCompatible).toBe(true);
    expect(drifted.blockers[0]).toBe("Source and destination schema or migrations differ. Review them before copying.");
    expect(drifted.blockers[1]).toContain("column|public|Category|merge_probe");
    expect(drifted.blockers.join(" ")).not.toContain("8e0ea07e");
  });

  it("reports a changed migration name without exposing its checksum", () => {
    const result = schemaCompatibility(
      ["column|public|User|id|uuid|true|-1|", "migration|present_on_production|checksum-a"],
      ["column|public|User|id|uuid|true|-1|", "migration|present_on_development|checksum-a"],
    );
    expect(result.schemaCompatible).toBe(true);
    expect(result.migrationsCompatible).toBe(false);
    expect(result.blockers.join("\n")).toContain("migration|present_on_production");
    expect(result.blockers.join("\n")).toContain("migration|present_on_development");
    expect(result.blockers.join("\n")).not.toContain("checksum-a");
  });
});

describe("ARCH-CLONE-003 locks, deadline and session pooler", () => {
  it("locks every public table and auth and rejects the wrong preview project", () => {
    const sql = lockCloneTablesSql(["Listing", "User"]);
    expect(sql).toContain('public."Listing"');
    expect(sql).toContain("auth.users");
    expect(sql).toContain("SHARE ROW EXCLUSIVE");
    expect(APPLY_DEADLINE_MS).toBeLessThan(300_000);
    expect(APPLY_STATEMENT_TIMEOUT).toBe("240s");
    expect(CLONE_PAGE_SIZE).toBeGreaterThanOrEqual(2_000);
    expect(isTransactionPoolerUrl("postgres://postgres.syneonzucehwlghqmfbg@aws-1-eu-west-2.pooler.supabase.com:6543/postgres")).toBe(true);
    expect(() => resolvePreviewSessionUrl({ NODE_ENV: "test", DATABASE_URL: "postgres://postgres.wrongref@aws-1-eu-west-2.pooler.supabase.com:6543/postgres" } as NodeJS.ProcessEnv)).toThrow("session connection");
  });

  it("prefers an IPv4 session pooler derived from a verified transaction URL", () => {
    const resolved = new URL(resolvePreviewSessionUrl({
      NODE_ENV: "test",
      POSTGRES_URL_NON_POOLING: "postgres://postgres:example@db.syneonzucehwlghqmfbg.supabase.co:5432/postgres",
      POSTGRES_URL: "postgres://postgres.syneonzucehwlghqmfbg:example@aws-1-eu-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require",
    } as NodeJS.ProcessEnv));

    expect(resolved.hostname).toBe("aws-1-eu-west-2.pooler.supabase.com");
    expect(resolved.port).toBe("5432");
    expect(resolved.searchParams.has("pgbouncer")).toBe(false);
    expect(resolved.searchParams.get("sslmode")).toBe("require");
  });
});

describe("ARCH-CLONE-004 auth safety", () => {
  it("bans imported users, clears secrets and blocks partial admin collisions", () => {
    const user = scrubAuthUser({ id: "auth-1", encrypted_password: "secret", confirmation_token: "tok", instance_id: "prod" }, "preview-instance");
    expect(authScrubViolations(user)).toEqual([]);
    expect(user).toMatchObject({ instance_id: "preview-instance", encrypted_password: "", banned_until: "infinity", confirmation_token: "" });
    expect(scrubIdentity({ identity_data: JSON.stringify({ email: "a@example.com", refresh_token: "secret" }) }).identity_data).toEqual({ email: "a@example.com" });
    const admin = { id: "admin", email: "admin@example.com", authUserId: "auth-admin" };
    expect(adminIdentityCollision([admin], { ...admin })).toBeNull();
    expect(preservedAuthCollision([admin], admin.authUserId, admin.id)).toBeNull();
    expect(adminIdentityCollision([admin], { id: "other", email: "admin@example.com", authUserId: "other-auth" })).toMatch(/collides/);
  });
});

describe("ARCH-CLONE-005 external effects", () => {
  it("fails closed when imported provenance matches and stays quiet outside staging", async () => {
    expect(await externalEffectBlocked({ emails: ["person@example.com"] })).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("ITRADER_DEPLOYMENT_ROLE", "staging");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://itrader.dev");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://syneonzucehwlghqmfbg.supabase.co");
    vi.stubEnv("DATABASE_URL", "postgres://postgres.syneonzucehwlghqmfbg@aws-1-eu-west-2.pooler.supabase.com:5432/postgres");
    const calls: string[] = [];
    const blocked = await externalEffectBlocked({ emails: ["person@example.com"] }, async () => {
      calls.push("query");
      if (calls.length === 1) return [{ present: true }];
      if (calls.length === 2) return [{ id: "generation-1" }];
      return [{ matched: 1 }];
    });
    expect(blocked).toBe(true);
  });
});

describe("ARCH-CLONE-006 backup retention", () => {
  const now = Date.parse("2026-10-04T00:00:00Z");
  const point = (id: string, createdAt: number, bytes: number, expiresAt: number | null, newest: boolean): BackupPoint => ({ id, createdAt, bytes, expiresAt, newest });

  it("keeps the newest backup and starts the displaced backup's 30 day clock", () => {
    const plan = planBackupRetention([point("old", now - 40 * 24 * 60 * 60 * 1000, 10, null, true)], now, { id: "new", bytes: 10 });
    expect(plan.ok && plan.dropIds).toEqual([]);
    expect(plan.ok && plan.expireUpdates).toEqual([{ id: "old", expiresAt: now + BACKUP_TTL_MS }]);
  });

  it("drops expired and excess backups without deleting the newest or accepting an oversized one", () => {
    const existing = [
      point("newest", now - 1_000, 20, null, true),
      point("expired", now - 10_000, 20, now - 1, false),
      point("old-a", now - 4_000, 20, now + 1_000, false),
      point("old-b", now - 3_000, 20, now + 1_000, false),
      point("old-c", now - 2_000, 20, now + 1_000, false),
    ];
    const plan = planBackupRetention(existing, now, { id: "incoming", bytes: 20 });
    expect(plan.ok && plan.dropIds).toEqual(["expired"]);
    const crowded = planBackupRetention([
      point("newest", now - 1_000, 20, null, true),
      point("old-a", now - 5_000, 20, now + 1_000, false),
      point("old-b", now - 4_000, 20, now + 1_000, false),
      point("old-c", now - 3_000, 20, now + 1_000, false),
      point("old-d", now - 2_000, 20, now + 1_000, false),
    ], now, { id: "incoming", bytes: 20 });
    expect(crowded.ok && crowded.dropIds).toEqual(["old-a"]);
    expect(crowded.ok && crowded.dropIds).not.toContain("incoming");
    expect(planBackupRetention([], now, { id: "huge", bytes: BACKUP_BUDGET_BYTES + 1 })).toMatchObject({ ok: false });
  });

  it("breaks nullable cycles and blocks required cycles", () => {
    const nullable = planCloneOrder(["A", "B"], [
      { name: "a_b", child: "A", parent: "B", childColumns: ["bId"], nullable: true, deferrable: false },
      { name: "b_a", child: "B", parent: "A", childColumns: ["aId"], nullable: true, deferrable: false },
    ]);
    expect(nullable.blockers).toEqual([]);
    expect(nullable.nullThenUpdate.length).toBeGreaterThan(0);
    const composite = planCloneOrder(["Response", "Revision"], [
      { name: "approved", child: "Response", parent: "Revision", childColumns: ["approvedRevisionId", "id"], nullable: true, nullableColumns: ["approvedRevisionId"], deferrable: false },
      { name: "parent", child: "Revision", parent: "Response", childColumns: ["responseId"], nullable: false, deferrable: false },
    ]);
    expect(composite.blockers).toEqual([]);
    expect(composite.nullThenUpdate).toContainEqual({ table: "Response", columns: ["approvedRevisionId"] });
    const required = planCloneOrder(["A", "B"], [
      { name: "a_b", child: "A", parent: "B", childColumns: ["bId"], nullable: false, deferrable: false },
      { name: "b_a", child: "B", parent: "A", childColumns: ["aId"], nullable: false, deferrable: false },
    ]);
    expect(required.blockers.length).toBeGreaterThan(0);
  });
});

describe("chunk integrity", () => {
  it("rejects a tampered chunk", async () => {
    const env = { NODE_ENV: "test", DATABASE_SYNC_ENCRYPTION_KEY: "a".repeat(64) } as NodeJS.ProcessEnv;
    const sealed = await sealChunk(Buffer.from("featured=true"), "itrader-database-sync-v2:run:backup:Listing:0", env);
    await expect(openChunk(sealed.ciphertext, "itrader-database-sync-v2:run:backup:Listing:1", env)).rejects.toThrow("could not be verified");
  });
});

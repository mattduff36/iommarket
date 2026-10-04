import { describe, expect, it, vi } from "vitest";
import { scrubAuthUser, scrubIdentity, adminIdentityCollision, authScrubViolations, preservedAuthCollision } from "@/lib/database-sync/auth-clone";
import { loadCloneCatalog, parsePrismaCatalog } from "@/lib/database-sync/catalog";
import { canonicalBytes, hashCanonical, parseCanonical, restoreValueExpression } from "@/lib/database-sync/codec";
import { openChunk, sealChunk } from "@/lib/database-sync/chunks";
import { hashSchemaLines } from "@/lib/database-sync/fingerprint";
import { lockCloneTablesSql, APPLY_DEADLINE_MS, APPLY_STATEMENT_TIMEOUT } from "@/lib/database-sync/clone-engine";
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
    expect(catalog.length).toBeGreaterThan(70);
    expect(catalog.find((table) => table.name === "Listing")?.columns.map((column) => column.name)).toContain("featured");
    expect(catalog.some((table) => table.name === "Payment")).toBe(true);
    expect(catalog.some((table) => table.name === "Subscription")).toBe(true);
    expect(catalog.every((table) => table.primaryKey && table.columns.length > 0)).toBe(true);
  });
});

describe("ARCH-CLONE-002 lossless codec and fingerprint", () => {
  it("round-trips featured and numeric text without JSON number coercion", () => {
    const bytes = canonicalBytes("Listing", [{ name: "featured", type: "boolean" }, { name: "markedGbpMinor", type: "bigint" }], [["true", "9007199254740993"]]);
    expect(parseCanonical(bytes).rows).toEqual([["true", "9007199254740993"]]);
    expect(hashCanonical(bytes)).toHaveLength(64);
    expect(restoreValueExpression("character varying(255)", 0)).toContain("CAST");
    expect(hashSchemaLines(["b", "a"])).toBe(hashSchemaLines(["a", "b"]));
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

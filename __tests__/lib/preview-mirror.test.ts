import { afterEach, describe, expect, it, vi } from "vitest";
import { createDecipheriv, createHmac } from "node:crypto";
import { gunzipSync } from "node:zlib";
import type { PoolClient } from "pg";
import { assertSourceStatement, startReadOnlySource } from "@/lib/preview-mirror/reader";
import { automaticMirrorDue } from "@/lib/preview-mirror/schedule";
import { mirrorSourceUrl, authorizeScheduledRequest, assertMirrorTargets } from "@/lib/preview-mirror/guards";
import { encryptedBackup } from "@/lib/preview-mirror/store";
import { tableDigest, type TableData } from "@/lib/preview-mirror/copy";
import { externalEffectBlocked } from "@/lib/database-sync/effects";

const env = {
  NODE_ENV: "production", VERCEL_ENV: "preview", ITRADER_DEPLOYMENT_ROLE: "staging",
  NEXT_PUBLIC_APP_URL: "https://itrader.dev", NEXT_PUBLIC_SUPABASE_URL: "https://syneonzucehwlghqmfbg.supabase.co",
  DATABASE_URL: "postgres://postgres.syneonzucehwlghqmfbg@aws-1-eu-west-2.pooler.supabase.com:5432/postgres",
  PREVIEW_MIRROR_SOURCE_READONLY_URL: "postgres://postgres.snlqivvogfqesxpbjiei@aws-1-eu-west-2.pooler.supabase.com:5432/postgres",
  PREVIEW_MIRROR_ENCRYPTION_KEY: "a".repeat(64),
} as NodeJS.ProcessEnv;
afterEach(() => vi.unstubAllEnvs());

describe("production reader safety", () => {
  it.each(["DELETE FROM public.x", "TRUNCATE public.x", "UPDATE x SET y=1", "SET transaction_read_only=off", "SELECT 1; DELETE FROM x", "WITH x AS (DELETE FROM y) SELECT 1"])("rejects %s", (sql) => {
    expect(() => assertSourceStatement(sql)).toThrow();
  });
  it("enforces and verifies a read-only transaction before giving access to queries", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ transaction_read_only: "on" }] });
    const source = await startReadOnlySource({ query } as unknown as PoolClient);
    expect(query.mock.calls.map((c) => c[0])).toEqual(["SET SESSION default_transaction_read_only=on", "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", "SHOW transaction_read_only"]);
    await source.query("SELECT 1");
    expect(() => source.query("DELETE FROM auth.users")).toThrow();
    expect(query).toHaveBeenCalledTimes(4);
  });
  it("refuses a writable source session", async () => {
    await expect(startReadOnlySource({ query: vi.fn().mockResolvedValue({ rows: [{ transaction_read_only: "off" }] }) } as unknown as PoolClient)).rejects.toThrow("read-only");
  });
  it("pins both environments and rejects swapped targets and transaction pooling", () => {
    expect(() => assertMirrorTargets(env)).not.toThrow();
    expect(() => assertMirrorTargets({ ...env, VERCEL_ENV: "production" })).toThrow();
    expect(() => assertMirrorTargets({ ...env, DATABASE_URL: env.PREVIEW_MIRROR_SOURCE_READONLY_URL })).toThrow();
    expect(() => mirrorSourceUrl({ ...env, PREVIEW_MIRROR_SOURCE_READONLY_URL: env.DATABASE_URL })).toThrow();
    expect(() => mirrorSourceUrl({ ...env, PREVIEW_MIRROR_SOURCE_READONLY_URL: env.PREVIEW_MIRROR_SOURCE_READONLY_URL!.replace("5432", "6543") })).toThrow();
  });
});

describe("mirror timing and recovery", () => {
  it("refreshes only after a full 72 hours since the latest success", () => {
    const start = Date.now(), interval = 72 * 60 * 60 * 1000;
    expect(automaticMirrorDue(start, start + interval - 1)).toBe(false);
    expect(automaticMirrorDue(start, start + interval)).toBe(true);
    expect(automaticMirrorDue(null, start)).toBe(true);
  });
  it("encrypts every original credential and authenticates backup contents", () => {
    const data: TableData[] = [{ schema: "auth", name: "users", columns: [{ name: "encrypted_password", type: "text", generated: "", identity: "" }], rows: [{ encrypted_password: "original-hash" }] }];
    const backup = encryptedBackup(data, "test-run", env.PREVIEW_MIRROR_ENCRYPTION_KEY!);
    expect(backup.includes(Buffer.from("original-hash"))).toBe(false);
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(env.PREVIEW_MIRROR_ENCRYPTION_KEY!, "hex"), backup.subarray(0, 12));
    decipher.setAAD(Buffer.from("test-run")); decipher.setAuthTag(backup.subarray(12, 28));
    expect(JSON.parse(gunzipSync(Buffer.concat([decipher.update(backup.subarray(28)), decipher.final()])).toString())).toEqual(data);
  });
  it("accepts only fresh signed scheduler requests without sending the secret", () => {
    const now = Date.now(), timestamp = String(now), secret = "a".repeat(64);
    const signature = createHmac("sha256", secret).update(`POST\n/api/cron/preview-mirror\n${timestamp}`).digest("hex");
    expect(authorizeScheduledRequest(signature, timestamp, secret, now)).toBe(true);
    expect(authorizeScheduledRequest(signature, timestamp, secret, now + 300001)).toBe(false);
    expect(authorizeScheduledRequest(signature, String(now + 1), secret, now)).toBe(false);
    expect(authorizeScheduledRequest(signature, timestamp, "b".repeat(64), now)).toBe(false);
  });
  it("detects changed contents independent of row ordering", () => {
    const table: TableData = { schema: "public", name: "t", columns: [{ name: "id", type: "bigint", generated: "", identity: "" }], rows: [{ id: "9007199254740993" }, { id: "2" }] };
    expect(tableDigest(table)).toBe(tableDigest({ ...table, rows: [...table.rows].reverse() }));
    expect(tableDigest(table)).not.toBe(tableDigest({ ...table, rows: [{ id: "9007199254740992" }, { id: "2" }] }));
  });
  it("blocks copied external references even if the copied application row was deleted", async () => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value!);
    const queries: unknown[] = [];
    const blocked = await externalEffectBlocked({ mediaIds: ["production-image-id"] }, async (sql) => {
      queries.push(sql);
      return queries.length === 1 ? [{ mirror_present: true }] : queries.length === 2 ? [{ id: "generation" }] : [{ found: 1 }];
    });
    expect(blocked).toBe(true);
    expect(queries).toHaveLength(3);
  });
});

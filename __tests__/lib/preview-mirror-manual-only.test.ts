import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";

const { pools, connectImpl, Pool } = vi.hoisted(() => {
  const pools: Array<{ connect: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }> = [];
  const connectImpl: { current: () => Promise<unknown> } = {
    current: async () => { throw new Error("stop before mirror"); },
  };
  class Pool {
    connect = vi.fn(() => connectImpl.current());
    end = vi.fn(async () => undefined);
    constructor() { pools.push(this); }
  }
  return { pools, connectImpl, Pool };
});
vi.mock("pg", () => ({ default: { Pool } }));

import { mirrorWithClients, readMirrorStatus, refreshPreviewMirror } from "@/lib/preview-mirror/engine";

const certificate = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
const env = {
  NODE_ENV: "production", VERCEL_ENV: "preview", ITRADER_DEPLOYMENT_ROLE: "staging",
  NEXT_PUBLIC_APP_URL: "https://itrader.dev", NEXT_PUBLIC_SUPABASE_URL: "https://syneonzucehwlghqmfbg.supabase.co",
  DATABASE_URL: "postgres://postgres.syneonzucehwlghqmfbg@aws-1-eu-west-2.pooler.supabase.com:5432/postgres",
  PREVIEW_MIRROR_SOURCE_READONLY_URL: "postgres://postgres.snlqivvogfqesxpbjiei@aws-1-eu-west-2.pooler.supabase.com:5432/postgres",
  PREVIEW_MIRROR_ENCRYPTION_KEY: "a".repeat(64),
  SUPABASE_DB_CA_CERT: certificate,
} as NodeJS.ProcessEnv;

beforeEach(() => {
  pools.length = 0;
  connectImpl.current = async () => { throw new Error("stop before mirror"); };
});

describe("preview mirror manual only", () => {
  it("rejects an automatic refresh before opening a connection", async () => {
    await expect(refreshPreviewMirror({ trigger: "automatic" }, { NODE_ENV: "test" })).rejects.toThrow("Automatic preview refresh is disabled.");
    expect(pools).toHaveLength(0);
  });

  it("rejects automatic mirrorWithClients before any query", async () => {
    const query = vi.fn(async () => { throw new Error("must not query"); });
    const client = { query } as unknown as PoolClient;
    await expect(mirrorWithClients({ trigger: "automatic" }, client, client, "key")).rejects.toThrow("Automatic preview refresh is disabled.");
    expect(query).not.toHaveBeenCalled();
  });

  it("still attempts a manual refresh connection and stops before copying", async () => {
    await expect(refreshPreviewMirror({ trigger: "manual", actorId: "admin-1" }, env)).rejects.toThrow("stop before mirror");
    expect(pools).toHaveLength(2);
    expect(pools[1]?.connect).toHaveBeenCalledOnce();
    expect(pools[0]?.connect).not.toHaveBeenCalled();
    expect(pools[0]?.end).toHaveBeenCalledOnce();
    expect(pools[1]?.end).toHaveBeenCalledOnce();
  });

  it("lets a manual engine call take the lock, then aborts without copying", async () => {
    const calls: string[] = [];
    const query = vi.fn(async (sql: string) => {
      calls.push(sql);
      throw new Error("stop before copy");
    });
    const client = { query } as unknown as PoolClient;
    await expect(mirrorWithClients({ trigger: "manual", actorId: "admin-1" }, client, client, "ab".repeat(32))).rejects.toThrow("Preview refresh failed.");
    expect(calls).toEqual(["SELECT pg_try_advisory_lock($1,$2) AS locked"]);
  });

  it("reports no upcoming automatic refresh even after a successful run", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ present: true }] })
      .mockResolvedValueOnce({ rows: [{ last_success_at: new Date("2026-10-09T09:00:00.000Z"), last_error: null }] });
    connectImpl.current = async () => ({ query, release: vi.fn() });
    await expect(readMirrorStatus(env)).resolves.toEqual({
      lastSuccessAt: "2026-10-09T09:00:00.000Z",
      nextAutomaticAt: null,
      lastError: null,
    });
  });
});

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  approveDesktopDevice,
  handleDesktopPost,
  memoryDesktopDependencies,
  type DesktopAccount,
  type DesktopDependencies,
} from "@/lib/dealer-stock-sync/desktop-service";
import {
  commandWorkerDevice,
  handleWorkerHeartbeat,
  memoryWorkerControlDependencies,
  readWorkerDashboard,
  WORKER_ACTIVITY_TEXT,
  type WorkerControlDependencies,
} from "@/lib/dealer-stock-sync/worker-control";
import {
  createLiveWorkerControlStore,
  createRedisWorkerControlStore,
  reduceHeartbeat,
  WORKER_COMMAND_TTL_SECONDS,
  WORKER_ONLINE_WINDOW_MS,
  WORKER_PRESENCE_TTL_SECONDS,
  WorkerControlUnavailable,
  workerControlKeys,
  workerControlScripts,
  type WorkerCommandRecord,
  type WorkerPresenceRecord,
} from "@/lib/dealer-stock-sync/worker-control-store";

const ADMIN_A = "cadmin0000000000000000001";
const ADMIN_B = "cadmin0000000000000000002";
const INSTANCE_A = "11111111-1111-4111-8111-111111111111";
const INSTANCE_B = "22222222-2222-4222-8222-222222222222";
const SECRET = "app-secret";

function databaseUrl(password: string): string {
  return `postgresql://postgres:${password}@db.syneonzucehwlghqmfbg.supabase.co:5432/postgres`;
}

function apiEnv(ids: string[]): Record<string, string> {
  return {
    DEALER_STOCK_DESKTOP_ENABLED: "1",
    DEALER_STOCK_DESKTOP_API_ONLY: "1",
    DEALER_STOCK_DESKTOP_ALLOWED_ADMIN_IDS: ids.join(","),
    VERCEL_ENV: "preview",
    DEALER_STOCK_SYNC_TARGET: "preview",
    NEXT_PUBLIC_APP_URL: "https://itrader.dev",
    NEXT_PUBLIC_SUPABASE_URL: "https://syneonzucehwlghqmfbg.supabase.co",
    DATABASE_URL: databaseUrl(SECRET),
    POSTGRES_URL: databaseUrl(SECRET),
    POSTGRES_URL_NON_POOLING: databaseUrl(SECRET),
  };
}

function account(id: string): DesktopAccount {
  return { id, name: "Stock Admin", email: "stock-admin@example.com", role: "ADMIN", disabledAt: null, deletedAt: null };
}

function harness() {
  let now = Date.parse("2026-10-22T20:00:00.000Z");
  const users = new Map<string, DesktopAccount>([[ADMIN_A, account(ADMIN_A)], [ADMIN_B, account(ADMIN_B)]]);
  const env = apiEnv([ADMIN_A, ADMIN_B]);
  const desktop = memoryDesktopDependencies(env, () => now, { async findById(id) { return users.get(id) ?? null; } });
  const deps = memoryWorkerControlDependencies(desktop, () => now);
  return { deps, env, advance: (ms: number) => { now += ms; }, now: () => now };
}

function post(deps: DesktopDependencies, body: unknown, authorization: string | null = null) {
  return handleDesktopPost(deps, { body, authorization, ip: "203.0.113.10", hasQuery: false });
}

function heartbeatBody(nowMs: number, overrides: Record<string, unknown> = {}) {
  return {
    op: "heartbeat",
    instanceId: INSTANCE_A,
    state: "waiting",
    activity: [{ sequence: 1, code: "ready", at: new Date(nowMs).toISOString() }],
    acknowledgedCommandId: null,
    ...overrides,
  };
}

async function issue(desktop: DesktopDependencies) {
  const secret = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(secret).digest("base64url");
  const started = await post(desktop, {
    op: "begin", deviceName: "Front Desk", codeChallenge: challenge, environment: "preview", clientVersion: "1.2.0",
  });
  if (!started.ok) throw new Error("pairing did not start");
  const approved = await approveDesktopDevice(desktop, {
    origin: "https://itrader.dev", host: "itrader.dev", forwardedHost: null,
    adminId: ADMIN_A, userCode: String(started.body.userCode),
  });
  if (!approved.ok) throw new Error("pairing was not approved");
  const issued = await post(desktop, { op: "poll", deviceCode: started.body.deviceCode, codeVerifier: secret });
  if (!issued.ok) throw new Error("session was not issued");
  return { authorization: `Bearer ${String(issued.body.accessToken)}`, deviceId: String(issued.body.deviceId), token: String(issued.body.accessToken) };
}

function browser(body: unknown) {
  return { adminId: ADMIN_A, origin: "https://itrader.dev", host: "itrader.dev", forwardedHost: null, body };
}

function presence(instanceId: string, seen: number): WorkerPresenceRecord {
  return {
    instanceId, state: "waiting", activity: [], lastSeenAt: new Date(seen).toISOString(),
    lastSeenMs: seen, acknowledgedCommandId: null,
  };
}

describe("worker presence and control", () => {
  it("authenticates every heartbeat, maps safe activity, and keeps commands on one live instance", async () => {
    const { deps, advance, now } = harness();
    const session = await issue(deps.desktop);
    const missing = await handleWorkerHeartbeat(deps, { body: heartbeatBody(now()), authorization: null });
    expect(missing).toMatchObject({ status: 401, error: "unauthorized" });
    const cookie = await handleWorkerHeartbeat(deps, {
      body: heartbeatBody(now()), authorization: "cookie accessToken=scoped-token",
    });
    expect(cookie).toMatchObject({ status: 401, error: "unauthorized" });

    const beat = await handleWorkerHeartbeat(deps, {
      body: heartbeatBody(now(), {
        activity: [
          { sequence: 1, code: "checking", at: new Date(now()).toISOString() },
          { sequence: 2, code: "error", at: new Date(now()).toISOString() },
        ],
      }),
      authorization: session.authorization,
    });
    expect(beat).toEqual({ ok: true, status: 200, body: { ok: true, command: null } });
    const dashboard = await readWorkerDashboard(deps, ADMIN_A);
    expect(dashboard.ok).toBe(true);
    if (!dashboard.ok) return;
    expect(dashboard.devices).toEqual([{
      deviceId: session.deviceId,
      deviceName: "Front Desk",
      environment: "preview",
      instanceId: INSTANCE_A,
      state: "waiting",
      online: true,
      lastSeenAt: new Date(now()).toISOString(),
      activity: [
        { sequence: 1, code: "checking", text: WORKER_ACTIVITY_TEXT.checking, at: new Date(now()).toISOString() },
        { sequence: 2, code: "error", text: "Needs attention", at: new Date(now()).toISOString() },
      ],
      pendingCommand: null,
    }]);
    expect(JSON.stringify(dashboard)).not.toContain(session.token);
    expect(JSON.stringify(dashboard)).not.toContain(SECRET);
    expect(JSON.stringify(dashboard)).not.toContain("sessionTokenHash");

    const command = await commandWorkerDevice(deps, browser({ deviceId: session.deviceId, instanceId: INSTANCE_A, action: "start" }));
    expect(command.ok).toBe(true);
    if (!command.ok) return;
    const delivered = await handleWorkerHeartbeat(deps, { body: heartbeatBody(now()), authorization: session.authorization });
    expect(delivered).toEqual({ ok: true, status: 200, body: { ok: true, command: command.command } });
    const wrongAck = await handleWorkerHeartbeat(deps, {
      body: heartbeatBody(now(), { acknowledgedCommandId: INSTANCE_B }),
      authorization: session.authorization,
    });
    expect(wrongAck).toEqual(delivered);
    const acked = await handleWorkerHeartbeat(deps, {
      body: heartbeatBody(now(), { acknowledgedCommandId: command.command.id }),
      authorization: session.authorization,
    });
    expect(acked).toEqual({ ok: true, status: 200, body: { ok: true, command: null } });
    const stored = await deps.control.readDevice(ADMIN_A, session.deviceId);
    expect(stored.presence?.acknowledgedCommandId).toBe(command.command.id);
    expect(stored.command).toBeNull();

    const replacement = await commandWorkerDevice(deps, browser({ deviceId: session.deviceId, instanceId: INSTANCE_A, action: "stop" }));
    if (!replacement.ok) throw new Error("replacement command was not stored");
    const raced = await handleWorkerHeartbeat(deps, {
      body: heartbeatBody(now(), { acknowledgedCommandId: command.command.id }),
      authorization: session.authorization,
    });
    expect(raced).toEqual({ ok: true, status: 200, body: { ok: true, command: replacement.command } });

    const restarted = await handleWorkerHeartbeat(deps, {
      body: heartbeatBody(now(), { instanceId: INSTANCE_B, state: "connected", activity: [] }),
      authorization: session.authorization,
    });
    expect(restarted).toEqual({ ok: true, status: 200, body: { ok: true, command: null } });
    expect((await deps.control.readDevice(ADMIN_A, session.deviceId)).command).toEqual(replacement.command);
    expect(await commandWorkerDevice(deps, browser({ deviceId: session.deviceId, instanceId: INSTANCE_A, action: "start" }))).toMatchObject({ error: "conflict" });
    const live = await commandWorkerDevice(deps, browser({ deviceId: session.deviceId, instanceId: INSTANCE_B, action: "start" }));
    expect(live.ok).toBe(true);
    const oldInstance = await handleWorkerHeartbeat(deps, { body: heartbeatBody(now()), authorization: session.authorization });
    expect(oldInstance).toEqual({ ok: true, status: 200, body: { ok: true, command: null } });
    const current = await handleWorkerHeartbeat(deps, {
      body: heartbeatBody(now(), { instanceId: INSTANCE_B, activity: [] }),
      authorization: session.authorization,
    });
    expect(current).toEqual({ ok: true, status: 200, body: { ok: true, command: live.ok ? live.command : null } });

    advance(WORKER_ONLINE_WINDOW_MS);
    expect(await commandWorkerDevice(deps, browser({ deviceId: session.deviceId, instanceId: INSTANCE_B, action: "stop" }))).toMatchObject({ ok: true });
    advance(1);
    const stale = await readWorkerDashboard(deps, ADMIN_A);
    expect(stale.ok && stale.devices[0]).toMatchObject({ online: false, instanceId: INSTANCE_B, lastSeenAt: expect.any(String) });
    expect(await commandWorkerDevice(deps, browser({ deviceId: session.deviceId, instanceId: INSTANCE_B, action: "start" }))).toMatchObject({ error: "conflict" });

    await handleWorkerHeartbeat(deps, {
      body: heartbeatBody(now(), { instanceId: INSTANCE_B, activity: [] }),
      authorization: session.authorization,
    });
    const expiring = await commandWorkerDevice(deps, browser({ deviceId: session.deviceId, instanceId: INSTANCE_B, action: "stop" }));
    advance(50_000);
    const stillThere = await handleWorkerHeartbeat(deps, {
      body: heartbeatBody(now(), { instanceId: INSTANCE_B, activity: [] }),
      authorization: session.authorization,
    });
    expect(stillThere).toEqual({ ok: true, status: 200, body: { ok: true, command: expiring.ok ? expiring.command : null } });
    advance(WORKER_COMMAND_TTL_SECONDS * 1000 - 50_000 + 1);
    const expired = await handleWorkerHeartbeat(deps, {
      body: heartbeatBody(now(), { instanceId: INSTANCE_B, activity: [] }),
      authorization: session.authorization,
    });
    expect(expired).toEqual({ ok: true, status: 200, body: { ok: true, command: null } });
  });

  it("fails closed for revocation, another admin, the environment gate, and redis", async () => {
    const { deps, env, advance, now } = harness();
    const session = await issue(deps.desktop);
    await handleWorkerHeartbeat(deps, { body: heartbeatBody(now()), authorization: session.authorization });
    advance(WORKER_PRESENCE_TTL_SECONDS * 1000 + 1);
    const gone = await readWorkerDashboard(deps, ADMIN_A);
    expect(gone.ok && gone.devices[0]).toEqual(expect.objectContaining({
      online: false, instanceId: null, state: null, lastSeenAt: null, pendingCommand: null,
    }));
    await handleWorkerHeartbeat(deps, { body: heartbeatBody(now()), authorization: session.authorization });
    expect(await post(deps.desktop, { op: "revoke" }, session.authorization)).toMatchObject({ ok: true });
    const revoked = await handleWorkerHeartbeat(deps, { body: heartbeatBody(now(), { state: "running" }), authorization: session.authorization });
    expect(revoked).toMatchObject({ status: 401, error: "unauthorized" });
    expect(JSON.stringify(revoked)).not.toContain(SECRET);
    expect(await readWorkerDashboard(deps, ADMIN_A)).toEqual({ ok: true, devices: [] });

    expect(await readWorkerDashboard(deps, ADMIN_B)).toEqual({ ok: true, devices: [] });
    expect(await commandWorkerDevice({ ...deps, env }, {
      ...browser({ deviceId: session.deviceId, instanceId: INSTANCE_A, action: "stop" }),
      adminId: ADMIN_B,
    })).toMatchObject({ error: "forbidden" });
    expect((await deps.control.readDevice(ADMIN_A, session.deviceId)).command).toBeNull();

    env.DEALER_STOCK_DESKTOP_ENABLED = "0";
    const disabled = await handleWorkerHeartbeat(deps, { body: heartbeatBody(now(), { state: "running" }), authorization: session.authorization });
    expect(disabled).toMatchObject({ status: 503, error: "unavailable" });
    expect(await readWorkerDashboard(deps, ADMIN_A)).toEqual({ ok: false, error: "unavailable" });
    expect(await commandWorkerDevice(deps, browser({ deviceId: session.deviceId, instanceId: INSTANCE_A, action: "start" }))).toMatchObject({ error: "unavailable" });
    env.DEALER_STOCK_DESKTOP_ENABLED = "1";
    const replacement = await issue(deps.desktop);
    await handleWorkerHeartbeat(deps, { body: heartbeatBody(now()), authorization: replacement.authorization });
    deps.desktop.store.listDevices = async () => { throw new Error(`redis://${SECRET}`); };
    expect(await readWorkerDashboard(deps, ADMIN_A)).toEqual({ ok: false, error: "unavailable" });
    expect(JSON.stringify(await readWorkerDashboard(deps, ADMIN_A))).not.toContain(SECRET);
    deps.control.recordHeartbeat = async () => { throw new WorkerControlUnavailable(); };
    const down = await handleWorkerHeartbeat(deps, { body: heartbeatBody(now()), authorization: replacement.authorization });
    expect(down).toEqual({ ok: false, status: 503, error: "unavailable" });
    expect(JSON.stringify(down)).not.toContain(SECRET);
  });

  it("rejects raw output, broken sequences, stale commands, and over-limit admin commands", async () => {
    const { deps, now } = harness();
    const session = await issue(deps.desktop);
    const rejected = [
      heartbeatBody(now(), { output: "secret scrape output" }),
      heartbeatBody(now(), { messages: ["secret scrape output"], user: ADMIN_A }),
      heartbeatBody(now(), { activity: [{ sequence: 2, code: "ready", at: new Date(now()).toISOString() }, { sequence: 2, code: "waiting", at: new Date(now()).toISOString() }] }),
      heartbeatBody(now(), { activity: [{ sequence: 1, code: "stdout", at: new Date(now()).toISOString() }] }),
      heartbeatBody(now(), { activity: [{ sequence: -1, code: "ready", at: new Date(now()).toISOString() }] }),
      heartbeatBody(now(), { activity: [{ sequence: 1, code: "ready", at: new Date(now() + 180_000).toISOString() }] }),
      heartbeatBody(now(), { activity: Array.from({ length: 41 }, (_, index) => ({ sequence: index, code: "ready", at: new Date(now()).toISOString() })) }),
      heartbeatBody(now(), { state: "scraping" }),
    ];
    for (const body of rejected) {
      const result = await handleWorkerHeartbeat(deps, { body, authorization: session.authorization });
      expect(result).toMatchObject({ status: 400, error: "invalid_request" });
      expect(JSON.stringify(result)).not.toContain("secret scrape output");
    }
    expect((await readWorkerDashboard(deps, ADMIN_A)).ok && (await readWorkerDashboard(deps, ADMIN_A))).toMatchObject({
      devices: [expect.objectContaining({ online: false, instanceId: null })],
    });
    await handleWorkerHeartbeat(deps, { body: heartbeatBody(now()), authorization: session.authorization });
    expect(await commandWorkerDevice(deps, browser({
      deviceId: session.deviceId, instanceId: INSTANCE_A, action: "start", args: ["restart"],
    }))).toMatchObject({ error: "invalid_request" });
    expect(await commandWorkerDevice(deps, {
      ...browser({ deviceId: session.deviceId, instanceId: INSTANCE_A, action: "start" }),
      origin: "https://itrader.dev.evil.test",
    })).toMatchObject({ error: "forbidden" });
    for (let count = 0; count < 10; count += 1) {
      expect((await commandWorkerDevice(deps, browser({ deviceId: session.deviceId, instanceId: INSTANCE_A, action: "start" }))).ok).toBe(true);
    }
    expect(await commandWorkerDevice(deps, browser({ deviceId: session.deviceId, instanceId: INSTANCE_A, action: "stop" }))).toMatchObject({ error: "rate_limited" });
    const beats = [];
    for (let count = 0; count < 24; count += 1) {
      beats.push(await handleWorkerHeartbeat(deps, { body: heartbeatBody(now(), { activity: [] }), authorization: session.authorization }));
    }
    expect(beats.filter((result) => result.ok)).toHaveLength(23);
    expect(beats.at(-1)).toMatchObject({ status: 429, error: "rate_limited" });
  });

  it("keeps presence and command keys separate and fails closed when redis is down", async () => {
    const seen = Date.parse("2026-10-22T20:00:00.000Z");
    const calls: Array<{ keys: string[]; args: string[] }> = [];
    const redis = {
      async eval(script: string, keys: string[], args: string[]) {
        calls.push({ keys, args });
        return script.includes("lastSeenMs") ? "offline" : "";
      },
    };
    const store = createRedisWorkerControlStore(redis, "preview");
    const deviceId = `dev_${"a".repeat(22)}`;
    expect(await store.recordHeartbeat({
      adminId: ADMIN_A, deviceId, presence: presence(INSTANCE_A, seen), acknowledgedCommandId: null,
    })).toBeNull();
    expect(await store.putCommand({
      adminId: ADMIN_A, deviceId, instanceId: INSTANCE_A,
      command: { id: "33333333-3333-4333-8333-333333333333", instanceId: INSTANCE_A, action: "stop" },
      nowMs: seen,
    })).toBe("offline");
    expect(calls[0]?.keys).toEqual([
      workerControlKeys("preview", ADMIN_A, deviceId).presence,
      workerControlKeys("preview", ADMIN_A, deviceId).command,
    ]);
    expect(calls[0]?.keys[0]).not.toBe(calls[0]?.keys[1]);
    expect(calls[0]?.args[1]).toBe(String(WORKER_PRESENCE_TTL_SECONDS));
    expect(calls[1]?.args[4]).toBe(String(WORKER_COMMAND_TTL_SECONDS));
    expect(workerControlScripts.heartbeat.indexOf("command.id == ack")).toBeLessThan(workerControlScripts.heartbeat.indexOf("DEL"));
    expect(workerControlScripts.heartbeat).not.toContain("SET', KEYS[2]");
    expect(workerControlScripts.command).toContain("SET', KEYS[2]");
    const current: WorkerCommandRecord = { id: "33333333-3333-4333-8333-333333333333", instanceId: INSTANCE_A, action: "start" };
    const raced = reduceHeartbeat(current, presence(INSTANCE_A, seen), "44444444-4444-4444-8444-444444444444");
    expect(raced.command).toEqual(current);
    expect(raced.returned).toEqual(current);
    expect(reduceHeartbeat(current, presence(INSTANCE_B, seen), current.id).command).toEqual(current);
    redis.eval = async () => { throw new Error(`redis://${SECRET}`); };
    await expect(store.readDevice(ADMIN_A, deviceId)).rejects.toBeInstanceOf(WorkerControlUnavailable);
    const live = createLiveWorkerControlStore({}, "preview");
    await expect(live.readDevice(ADMIN_A, deviceId)).rejects.toBeInstanceOf(WorkerControlUnavailable);
  });
});

describe("worker action module", () => {
  it("exports only the dashboard and command server actions", () => {
    const source = readFileSync(resolve(process.cwd(), "app/(admin)/admin/stock-reviews/worker-actions.ts"), "utf8");
    expect(source.startsWith('"use server"')).toBe(true);
    expect(source).toContain("export async function getWorkerDashboard");
    expect(source).toContain("export async function commandWorker");
    expect(source).not.toMatch(/export\s*\{/);
    expect(source).not.toContain("console.");
  });
});

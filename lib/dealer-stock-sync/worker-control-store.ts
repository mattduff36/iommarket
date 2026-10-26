import { Redis } from "@upstash/redis";
import type { DesktopEnvironment } from "@/lib/dealer-stock-sync/desktop-config";

export const WORKER_PRESENCE_TTL_SECONDS = 120;
export const WORKER_COMMAND_TTL_SECONDS = 60;
export const WORKER_ONLINE_WINDOW_MS = 35_000;

const ADMIN_ID = /^c[a-z0-9]{24,32}$/;
const DEVICE_ID = /^dev_[A-Za-z0-9_-]{22}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const WORKER_ACTIVITY_CODES = [
  "checking",
  "ready",
  "waiting",
  "processing",
  "staging-photos",
  "processing-finished",
  "applied",
  "stopping",
  "stopped",
  "error",
] as const;

export const WORKER_RUNTIME_STATES = [
  "connected",
  "waiting",
  "running",
  "stopping",
  "stopped",
  "error",
] as const;

export type WorkerActivityCode = (typeof WORKER_ACTIVITY_CODES)[number];
export type WorkerRuntimeState = (typeof WORKER_RUNTIME_STATES)[number];
export type WorkerCommandAction = "start" | "stop";

export interface WorkerActivityEvent {
  sequence: number;
  code: WorkerActivityCode;
  at: string;
}

export interface WorkerPresenceRecord {
  instanceId: string;
  state: WorkerRuntimeState;
  activity: WorkerActivityEvent[];
  lastSeenAt: string;
  lastSeenMs: number;
  acknowledgedCommandId: string | null;
}

export interface WorkerCommandRecord {
  id: string;
  instanceId: string;
  action: WorkerCommandAction;
}

export interface WorkerControlSnapshot {
  presence: WorkerPresenceRecord | null;
  command: WorkerCommandRecord | null;
}

export type WorkerCommandWrite = "ok" | "offline" | "mismatch" | "stale";

export interface WorkerControlStore {
  recordHeartbeat(input: {
    adminId: string;
    deviceId: string;
    presence: WorkerPresenceRecord;
    acknowledgedCommandId: string | null;
  }): Promise<WorkerCommandRecord | null>;
  readDevice(adminId: string, deviceId: string): Promise<WorkerControlSnapshot>;
  putCommand(input: {
    adminId: string;
    deviceId: string;
    instanceId: string;
    command: WorkerCommandRecord;
    nowMs: number;
  }): Promise<WorkerCommandWrite>;
}

export class WorkerControlUnavailable extends Error {
  constructor() {
    super("Worker control store is unavailable");
    this.name = "WorkerControlUnavailable";
  }
}

interface RedisCommands {
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}

interface MemorySlot<T> {
  value: T;
  expiresAt: number;
}

interface MemoryBucket {
  presence: MemorySlot<WorkerPresenceRecord> | null;
  command: MemorySlot<WorkerCommandRecord> | null;
}

const HEARTBEAT_SCRIPT = `
local ok, presence = pcall(cjson.decode, ARGV[1])
if not ok or type(presence) ~= 'table' or presence.instanceId ~= ARGV[3] then return 'invalid' end
local ack = ARGV[4]
local function savePresence()
  -- Redis cjson re-encodes an empty JSON array as an object. Preserve the
  -- validated activity array bytes so an idle heartbeat remains readable.
  presence.activity = nil
  local encoded = cjson.encode(presence)
  encoded = string.sub(encoded, 1, -2) .. ',"activity":' .. ARGV[5] .. '}'
  redis.call('SET', KEYS[1], encoded, 'EX', ARGV[2])
end
local raw = redis.call('GET', KEYS[2])
local command = nil
if raw and raw ~= '' then
  local parsed, data = pcall(cjson.decode, raw)
  if parsed and type(data) == 'table' and type(data.id) == 'string' and type(data.instanceId) == 'string'
    and data.instanceId == ARGV[3] and (data.action == 'start' or data.action == 'stop') then
    command = data
  elseif parsed and type(data) == 'table' and type(data.instanceId) == 'string' and data.instanceId ~= ARGV[3] then
    command = false
  else
    return 'invalid'
  end
end
if command and ack ~= '' and command.id == ack then
  presence.acknowledgedCommandId = ack
  savePresence()
  redis.call('DEL', KEYS[2])
  return ''
end
presence.acknowledgedCommandId = cjson.null
savePresence()
if command then return cjson.encode({ id = command.id, instanceId = command.instanceId, action = command.action }) end
return ''
`;

const COMMAND_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw or raw == '' then return 'offline' end
local ok, presence = pcall(cjson.decode, raw)
if not ok or type(presence) ~= 'table' then return 'invalid' end
if presence.instanceId ~= ARGV[1] then return 'mismatch' end
local seen = tonumber(presence.lastSeenMs)
local now = tonumber(ARGV[2])
local window = tonumber(ARGV[3])
if not seen or not now or not window then return 'stale' end
local age = now - seen
if age < 0 or age > window then return 'stale' end
redis.call('SET', KEYS[2], ARGV[4], 'EX', ARGV[5])
return 'ok'
`;

const READ_SCRIPT = `
local presence = redis.call('GET', KEYS[1])
local command = redis.call('GET', KEYS[2])
return { presence or '', command or '' }
`;

function keyPrefix(environment: DesktopEnvironment): string {
  return `itrader:stock-worker:${environment}`;
}

function scopedIds(adminId: string, deviceId: string): boolean {
  return ADMIN_ID.test(adminId) && DEVICE_ID.test(deviceId);
}

export function workerControlKeys(
  environment: DesktopEnvironment,
  adminId: string,
  deviceId: string,
): { presence: string; command: string } {
  if (!scopedIds(adminId, deviceId)) throw new WorkerControlUnavailable();
  const prefix = `${keyPrefix(environment)}:admin:${adminId}:device:${deviceId}`;
  return { presence: `${prefix}:presence`, command: `${prefix}:command` };
}

function isCode(value: unknown): value is WorkerActivityCode {
  return WORKER_ACTIVITY_CODES.some((code) => code === value);
}

function isState(value: unknown): value is WorkerRuntimeState {
  return WORKER_RUNTIME_STATES.some((state) => state === value);
}

function isAction(value: unknown): value is WorkerCommandAction {
  return value === "start" || value === "stop";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function activityFrom(value: unknown): WorkerActivityEvent[] | null {
  if (!Array.isArray(value) || value.length > 40) return null;
  const events: WorkerActivityEvent[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record || typeof record.sequence !== "number" || !Number.isSafeInteger(record.sequence) || record.sequence < 0) return null;
    if (!isCode(record.code) || typeof record.at !== "string") return null;
    events.push({ sequence: record.sequence, code: record.code, at: record.at });
  }
  return events;
}

export function presenceFrom(value: unknown): WorkerPresenceRecord | null {
  const record = asRecord(value);
  if (!record || typeof record.instanceId !== "string" || !UUID.test(record.instanceId)) return null;
  if (!isState(record.state) || typeof record.lastSeenAt !== "string" || typeof record.lastSeenMs !== "number") return null;
  if (!Number.isSafeInteger(record.lastSeenMs)) return null;
  const activity = activityFrom(record.activity);
  if (!activity) return null;
  const acknowledged = record.acknowledgedCommandId ?? null;
  if (acknowledged !== null && (typeof acknowledged !== "string" || !UUID.test(acknowledged))) return null;
  return {
    instanceId: record.instanceId,
    state: record.state,
    activity,
    lastSeenAt: record.lastSeenAt,
    lastSeenMs: record.lastSeenMs,
    acknowledgedCommandId: acknowledged,
  };
}

export function commandFrom(value: unknown): WorkerCommandRecord | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== "string" || !UUID.test(record.id)) return null;
  if (typeof record.instanceId !== "string" || !UUID.test(record.instanceId) || !isAction(record.action)) return null;
  return { id: record.id, instanceId: record.instanceId, action: record.action };
}

function assertPresence(presence: WorkerPresenceRecord, ack: string | null): void {
  if (!presenceFrom(presence) || (ack !== null && !UUID.test(ack))) throw new WorkerControlUnavailable();
}

function assertCommand(command: WorkerCommandRecord, instanceId: string): void {
  if (!commandFrom(command) || command.instanceId !== instanceId || !UUID.test(instanceId)) {
    throw new WorkerControlUnavailable();
  }
}

export function reduceHeartbeat(
  current: WorkerCommandRecord | null,
  presence: WorkerPresenceRecord,
  acknowledgedCommandId: string | null,
): { presence: WorkerPresenceRecord; command: WorkerCommandRecord | null; returned: WorkerCommandRecord | null } {
  const sameInstance = current?.instanceId === presence.instanceId;
  const matched = Boolean(sameInstance && current && acknowledgedCommandId && current.id === acknowledgedCommandId);
  const stored: WorkerPresenceRecord = {
    ...presence,
    activity: presence.activity.map((event) => ({ ...event })),
    acknowledgedCommandId: matched ? acknowledgedCommandId : null,
  };
  if (!sameInstance || !current) return { presence: stored, command: current, returned: null };
  if (matched) return { presence: stored, command: null, returned: null };
  return { presence: stored, command: current, returned: { ...current } };
}

export function reduceCommand(
  presence: WorkerPresenceRecord | null,
  instanceId: string,
  nowMs: number,
): Exclude<WorkerCommandWrite, "ok"> | "ready" {
  if (!presence) return "offline";
  if (presence.instanceId !== instanceId) return "mismatch";
  if (Date.parse(presence.lastSeenAt) !== presence.lastSeenMs) return "stale";
  const age = nowMs - presence.lastSeenMs;
  if (age < 0 || age > WORKER_ONLINE_WINDOW_MS) return "stale";
  return "ready";
}

async function redisCall<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof WorkerControlUnavailable) throw error;
    throw new WorkerControlUnavailable();
  }
}

export function createRedisWorkerControlStore(
  redis: RedisCommands,
  environment: DesktopEnvironment,
): WorkerControlStore {
  return {
    async recordHeartbeat({ adminId, deviceId, presence, acknowledgedCommandId }) {
      return redisCall(async () => {
        assertPresence(presence, acknowledgedCommandId);
        const keys = workerControlKeys(environment, adminId, deviceId);
        const result = await redis.eval(
          HEARTBEAT_SCRIPT,
          [keys.presence, keys.command],
          [
            JSON.stringify({ ...presence, acknowledgedCommandId: null }),
            String(WORKER_PRESENCE_TTL_SECONDS),
            presence.instanceId,
            acknowledgedCommandId ?? "",
            JSON.stringify(presence.activity),
          ],
        );
        if (result === "invalid") throw new WorkerControlUnavailable();
        if (result == null || result === "") return null;
        const command = commandFrom(result);
        if (!command || command.instanceId !== presence.instanceId) throw new WorkerControlUnavailable();
        return command;
      });
    },
    async readDevice(adminId, deviceId) {
      return redisCall(async () => {
        const keys = workerControlKeys(environment, adminId, deviceId);
        const result = await redis.eval(READ_SCRIPT, [keys.presence, keys.command], []);
        if (!Array.isArray(result) || result.length !== 2) throw new WorkerControlUnavailable();
        // Upstash can automatically deserialize each nested JSON result.
        const presenceText = result[0];
        const commandText = result[1];
        const presence = presenceText ? presenceFrom(presenceText) : null;
        const command = commandText ? commandFrom(commandText) : null;
        if ((presenceText && !presence) || (commandText && !command)) throw new WorkerControlUnavailable();
        return { presence, command };
      });
    },
    async putCommand({ adminId, deviceId, instanceId, command, nowMs }) {
      return redisCall(async () => {
        assertCommand(command, instanceId);
        const keys = workerControlKeys(environment, adminId, deviceId);
        const result = await redis.eval(
          COMMAND_SCRIPT,
          [keys.presence, keys.command],
          [instanceId, String(nowMs), String(WORKER_ONLINE_WINDOW_MS), JSON.stringify(command), String(WORKER_COMMAND_TTL_SECONDS)],
        );
        if (result === "ok" || result === "offline" || result === "mismatch" || result === "stale") return result;
        throw new WorkerControlUnavailable();
      });
    },
  };
}

export function createLiveWorkerControlStore(
  env: Record<string, string | undefined>,
  environment: DesktopEnvironment,
): WorkerControlStore {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token || !url.startsWith("https://")) return unavailableWorkerControlStore();
  return createRedisWorkerControlStore(new Redis({ url, token }), environment);
}

export function unavailableWorkerControlStore(): WorkerControlStore {
  const fail = async (): Promise<never> => {
    throw new WorkerControlUnavailable();
  };
  return { recordHeartbeat: fail, readDevice: fail, putCommand: fail };
}

function liveSlot<T>(slot: MemorySlot<T> | null, nowMs: number): MemorySlot<T> | null {
  if (!slot || slot.expiresAt <= nowMs) return null;
  return slot;
}

export function createMemoryWorkerControlStore(
  now: () => number,
  environment: DesktopEnvironment,
): WorkerControlStore {
  const buckets = new Map<string, MemoryBucket>();

  function bucket(adminId: string, deviceId: string): MemoryBucket {
    const keys = workerControlKeys(environment, adminId, deviceId);
    const name = keys.presence;
    const existing = buckets.get(name);
    if (existing) return existing;
    const created: MemoryBucket = { presence: null, command: null };
    buckets.set(name, created);
    return created;
  }

  function snapshot(adminId: string, deviceId: string): WorkerControlSnapshot {
    const current = bucket(adminId, deviceId);
    const nowMs = now();
    current.presence = liveSlot(current.presence, nowMs);
    current.command = liveSlot(current.command, nowMs);
    return {
      presence: current.presence ? presenceFrom(current.presence.value) : null,
      command: current.command ? commandFrom(current.command.value) : null,
    };
  }

  return {
    async recordHeartbeat({ adminId, deviceId, presence, acknowledgedCommandId }) {
      assertPresence(presence, acknowledgedCommandId);
      const current = bucket(adminId, deviceId);
      const nowMs = now();
      current.command = liveSlot(current.command, nowMs);
      const reduced = reduceHeartbeat(current.command?.value ?? null, presence, acknowledgedCommandId);
      current.presence = { value: reduced.presence, expiresAt: nowMs + WORKER_PRESENCE_TTL_SECONDS * 1000 };
      current.command = reduced.command && current.command
        ? { value: reduced.command, expiresAt: current.command.expiresAt }
        : null;
      return reduced.returned;
    },
    async readDevice(adminId, deviceId) {
      const read = snapshot(adminId, deviceId);
      if ((read.presence && !presenceFrom(read.presence)) || (read.command && !commandFrom(read.command))) {
        throw new WorkerControlUnavailable();
      }
      return read;
    },
    async putCommand({ adminId, deviceId, instanceId, command, nowMs }) {
      assertCommand(command, instanceId);
      const current = bucket(adminId, deviceId);
      current.presence = liveSlot(current.presence, nowMs);
      current.command = liveSlot(current.command, nowMs);
      const decision = reduceCommand(current.presence?.value ?? null, instanceId, nowMs);
      if (decision !== "ready") return decision;
      current.command = { value: { ...command }, expiresAt: nowMs + WORKER_COMMAND_TTL_SECONDS * 1000 };
      return "ok";
    },
  };
}

export const workerControlScripts = {
  heartbeat: HEARTBEAT_SCRIPT,
  command: COMMAND_SCRIPT,
};

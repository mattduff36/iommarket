import { timingSafeEqual } from "node:crypto";
import { Redis } from "@upstash/redis";
import type { DesktopEnvironment } from "@/lib/dealer-stock-sync/desktop-config";

function fixedEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class DesktopStoreUnavailable extends Error {
  constructor() {
    super("Desktop authorisation store is unavailable");
    this.name = "DesktopStoreUnavailable";
  }
}

export interface PendingRecord {
  status: "pending" | "approved";
  challenge: string;
  deviceName: string;
  environment: DesktopEnvironment;
  clientVersion: string;
  deviceId: string;
  adminId: string | null;
  userCodeHash: string;
  expiresAt: string;
}

export interface SessionRecord {
  adminId: string;
  deviceId: string;
  deviceName: string;
  environment: DesktopEnvironment;
  expiresAt: string;
}

export interface DeviceRecord {
  adminId: string;
  deviceId: string;
  deviceName: string;
  environment: DesktopEnvironment;
  sessionTokenHash: string;
  createdAt: string;
  expiresAt: string;
}

export type ClaimOutcome = "missing" | "rejected" | "pending" | "issued";

export interface DesktopStore {
  savePending(deviceHash: string, record: PendingRecord, ttlSeconds: number): Promise<"ok" | "conflict">;
  readInvitation(userCodeHash: string): Promise<Pick<PendingRecord, "deviceName" | "environment" | "status"> | null>;
  approve(userCodeHash: string, adminId: string, environment: DesktopEnvironment): Promise<"ok" | "missing">;
  claim(deviceHash: string, challenge: string, tokenHash: string, ttlSeconds: number, expiresAt: string, createdAt: string): Promise<ClaimOutcome>;
  readSession(tokenHash: string): Promise<SessionRecord | null>;
  revokeSession(tokenHash: string): Promise<"ok" | "missing">;
  revokeDevice(adminId: string, deviceId: string): Promise<"ok" | "missing">;
  listDevices(adminId: string): Promise<DeviceRecord[]>;
  consumeRate(bucket: string, limit: number, windowSeconds: number): Promise<boolean>;
}

interface RedisCommands {
  set(key: string, value: unknown, opts?: { ex: number; nx: true }): Promise<unknown>;
  get(key: string): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
  smembers(key: string): Promise<string[]>;
}

const CLAIM_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 'missing' end
local ok, data = pcall(cjson.decode, raw)
if not ok or type(data) ~= 'table' then return 'lost' end
if data.challenge ~= ARGV[1] or data.environment ~= ARGV[2] then return 'rejected' end
if data.expiresAt ~= ARGV[3] then return 'lost' end
if data.status ~= 'approved' or type(data.adminId) ~= 'string' or data.adminId == '' then return 'pending' end
if type(data.deviceId) ~= 'string' or type(data.userCodeHash) ~= 'string' then return 'pending' end
if #KEYS ~= 5 then return 'lost' end
if data.adminId ~= ARGV[4] or data.deviceId ~= ARGV[5] or data.userCodeHash ~= ARGV[6] then return 'lost' end
local function matched(key, marker, id)
  local suffix = marker .. id
  return type(key) == 'string' and #key >= #suffix and string.sub(key, -#suffix) == suffix
end
if not matched(KEYS[2], ':session:', ARGV[7]) then return 'lost' end
if not matched(KEYS[3], ':device:', data.deviceId) then return 'lost' end
if not matched(KEYS[4], ':admin:', data.adminId) then return 'lost' end
if not matched(KEYS[5], ':user:', data.userCodeHash) then return 'lost' end
local session = cjson.encode({ adminId = data.adminId, deviceId = data.deviceId, deviceName = data.deviceName, environment = data.environment, expiresAt = ARGV[8] })
local device = cjson.encode({ adminId = data.adminId, deviceId = data.deviceId, deviceName = data.deviceName, environment = data.environment, sessionTokenHash = ARGV[7], createdAt = ARGV[9], expiresAt = ARGV[8] })
local created = redis.call('SET', KEYS[2], session, 'EX', ARGV[10], 'NX')
if not created then return 'rejected' end
redis.call('DEL', KEYS[1], KEYS[5])
redis.call('SET', KEYS[3], device, 'EX', ARGV[10])
redis.call('SADD', KEYS[4], data.deviceId)
redis.call('EXPIRE', KEYS[4], ARGV[10])
return 'issued'
`;

const APPROVE_SCRIPT = `
local pointed = redis.call('GET', KEYS[1])
if pointed ~= KEYS[2] then return 'missing' end
local raw = redis.call('GET', KEYS[2])
if not raw then return 'missing' end
local data = cjson.decode(raw)
if type(data) ~= 'table' or data.status ~= 'pending' or data.environment ~= ARGV[2] then return 'missing' end
local ttl = redis.call('TTL', KEYS[2])
if ttl < 1 then return 'missing' end
data.status = 'approved'
data.adminId = ARGV[1]
redis.call('SET', KEYS[2], cjson.encode(data), 'EX', ttl)
redis.call('DEL', KEYS[1])
return 'ok'
`;

const REVOKE_SESSION_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 'missing' end
local data = cjson.decode(raw)
if type(data) ~= 'table' or data.deviceId ~= ARGV[1] then return 'missing' end
redis.call('DEL', KEYS[1], KEYS[2])
redis.call('SREM', KEYS[3], ARGV[1])
return 'ok'
`;

const REVOKE_DEVICE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 'missing' end
local data = cjson.decode(raw)
if type(data) ~= 'table' or data.adminId ~= ARGV[1] or data.sessionTokenHash ~= ARGV[2] then return 'missing' end
redis.call('DEL', KEYS[1], KEYS[2])
redis.call('SREM', KEYS[3], data.deviceId)
return 'ok'
`;

const RATE_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
if current > tonumber(ARGV[2]) then return 0 end
return 1
`;

function keyPrefix(environment: DesktopEnvironment): string {
  return `itrader:stock-desktop:${environment}`;
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

function isEnvironment(value: unknown): value is DesktopEnvironment {
  return value === "preview" || value === "production";
}

function expiryState(value: unknown, nowMs: number): "open" | "expired" | "corrupt" {
  if (typeof value !== "string") return "corrupt";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "corrupt";
  return parsed > nowMs ? "open" : "expired";
}

function pendingFrom(value: unknown): PendingRecord | null {
  const record = asRecord(value);
  if (!record || (record.status !== "pending" && record.status !== "approved")) return null;
  if (typeof record.challenge !== "string" || typeof record.deviceName !== "string") return null;
  if (!isEnvironment(record.environment) || typeof record.deviceId !== "string") return null;
  if (typeof record.clientVersion !== "string" || typeof record.userCodeHash !== "string") return null;
  if (typeof record.expiresAt !== "string") return null;
  if (record.adminId !== null && typeof record.adminId !== "string") return null;
  return record as unknown as PendingRecord;
}

function sessionFrom(value: unknown): SessionRecord | null {
  const record = asRecord(value);
  if (!record || typeof record.adminId !== "string" || typeof record.deviceId !== "string") return null;
  if (typeof record.deviceName !== "string" || !isEnvironment(record.environment)) return null;
  if (typeof record.expiresAt !== "string") return null;
  return record as unknown as SessionRecord;
}

function deviceFrom(value: unknown): DeviceRecord | null {
  const record = asRecord(value);
  if (!record || typeof record.adminId !== "string" || typeof record.deviceId !== "string") return null;
  if (typeof record.deviceName !== "string" || !isEnvironment(record.environment)) return null;
  if (typeof record.sessionTokenHash !== "string" || typeof record.createdAt !== "string") return null;
  if (typeof record.expiresAt !== "string") return null;
  return record as unknown as DeviceRecord;
}

async function redisCall<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DesktopStoreUnavailable) throw error;
    throw new DesktopStoreUnavailable();
  }
}

export function createRedisDesktopStore(
  redis: RedisCommands,
  environment: DesktopEnvironment,
  now: () => number = Date.now,
): DesktopStore {
  const prefix = keyPrefix(environment);
  const pendingKey = (hash: string) => `${prefix}:pending:${hash}`;
  const userKey = (hash: string) => `${prefix}:user:${hash}`;
  const sessionKey = (hash: string) => `${prefix}:session:${hash}`;
  const deviceKey = (deviceId: string) => `${prefix}:device:${deviceId}`;
  const adminKey = (adminId: string) => `${prefix}:admin:${adminId}`;
  const rateKey = (bucket: string) => `${prefix}:rate:${bucket}`;

  return {
    async savePending(deviceHash, record, ttlSeconds) {
      return redisCall(async () => {
        const saved = await redis.set(pendingKey(deviceHash), record, { ex: ttlSeconds, nx: true });
        if (saved !== "OK") return "conflict";
        const linked = await redis.set(userKey(record.userCodeHash), pendingKey(deviceHash), { ex: ttlSeconds, nx: true });
        if (linked !== "OK") {
          await redis.del(pendingKey(deviceHash));
          return "conflict";
        }
        return "ok";
      });
    },
    async readInvitation(userCodeHash) {
      return redisCall(async () => {
        const pointed = await redis.get(userKey(userCodeHash));
        if (typeof pointed !== "string") return null;
        const pending = pendingFrom(await redis.get(pointed));
        if (!pending || pending.status !== "pending" || expiryState(pending.expiresAt, now()) !== "open") return null;
        if (pending.environment !== environment) return null;
        return { deviceName: pending.deviceName, environment: pending.environment, status: pending.status };
      });
    },
    async approve(userCodeHash, adminId, expectedEnvironment) {
      return redisCall(async () => {
        const pointed = await redis.get(userKey(userCodeHash));
        if (typeof pointed !== "string" || pointed !== pendingKeyFromPointer(pointed, prefix)) return "missing";
        const result = await redis.eval(APPROVE_SCRIPT, [userKey(userCodeHash), pointed], [adminId, expectedEnvironment]);
        return result === "ok" ? "ok" : "missing";
      });
    },
    async claim(deviceHash, challenge, tokenHash, ttlSeconds, expiresAt, createdAt) {
      return redisCall(async () => {
        const pendingKeyValue = pendingKey(deviceHash);
        const raw = await redis.get(pendingKeyValue);
        if (raw == null || raw === "") return "missing";
        const pending = pendingFrom(raw);
        if (!pending) throw new DesktopStoreUnavailable();
        const expiry = expiryState(pending.expiresAt, now());
        if (expiry === "corrupt") throw new DesktopStoreUnavailable();
        if (expiry === "expired") return "missing";
        if (pending.environment !== environment || !fixedEqual(pending.challenge, challenge)) return "rejected";
        // Approval can race this read. Returning pending is harmless; only the
        // approved transition requires atomic consumption on the next poll.
        if (pending.status !== "approved" || !pending.adminId) return "pending";
        const keys = [pendingKeyValue];
        const args = [
          challenge,
          environment,
          pending.expiresAt,
          pending.adminId ?? "",
          pending.deviceId,
          pending.userCodeHash,
          tokenHash,
          expiresAt,
          createdAt,
          String(ttlSeconds),
        ];
        if (pending.status === "approved" && pending.adminId) {
          keys.push(sessionKey(tokenHash), deviceKey(pending.deviceId), adminKey(pending.adminId), userKey(pending.userCodeHash));
        }
        const result = await redis.eval(CLAIM_SCRIPT, keys, args);
        if (result === "missing" || result === "rejected" || result === "pending" || result === "issued") return result;
        throw new DesktopStoreUnavailable();
      });
    },
    async readSession(tokenHash) {
      return redisCall(async () => {
        const session = sessionFrom(await redis.get(sessionKey(tokenHash)));
        if (!session || session.environment !== environment) return null;
        const expiry = expiryState(session.expiresAt, now());
        if (expiry === "corrupt") throw new DesktopStoreUnavailable();
        return expiry === "open" ? session : null;
      });
    },
    async revokeSession(tokenHash) {
      return redisCall(async () => {
        const session = sessionFrom(await redis.get(sessionKey(tokenHash)));
        if (!session) return "missing";
        const device = deviceFrom(await redis.get(deviceKey(session.deviceId)));
        if (!device || device.sessionTokenHash !== tokenHash) return "missing";
        const result = await redis.eval(
          REVOKE_SESSION_SCRIPT,
          [sessionKey(tokenHash), deviceKey(session.deviceId), adminKey(session.adminId)],
          [session.deviceId],
        );
        return result === "ok" ? "ok" : "missing";
      });
    },
    async revokeDevice(adminId, deviceId) {
      return redisCall(async () => {
        const device = deviceFrom(await redis.get(deviceKey(deviceId)));
        if (!device || device.adminId !== adminId) return "missing";
        const result = await redis.eval(
          REVOKE_DEVICE_SCRIPT,
          [deviceKey(deviceId), sessionKey(device.sessionTokenHash), adminKey(adminId)],
          [adminId, device.sessionTokenHash],
        );
        return result === "ok" ? "ok" : "missing";
      });
    },
    async listDevices(adminId) {
      return redisCall(async () => {
        const ids = await redis.smembers(adminKey(adminId));
        const devices: DeviceRecord[] = [];
        for (const id of ids) {
          const device = deviceFrom(await redis.get(deviceKey(id)));
          if (device?.adminId === adminId) devices.push(device);
        }
        return devices;
      });
    },
    async consumeRate(bucket, limit, windowSeconds) {
      return redisCall(async () => {
        const result = await redis.eval(RATE_SCRIPT, [rateKey(bucket)], [String(windowSeconds), String(limit)]);
        return result === 1 || result === "1";
      });
    },
  };
}

function pendingKeyFromPointer(pointer: string, prefix: string): string {
  return pointer.startsWith(`${prefix}:pending:`) ? pointer : "";
}

export function createLiveDesktopStore(env: Record<string, string | undefined>, environment: DesktopEnvironment): DesktopStore {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token || !url.startsWith("https://")) return unavailableDesktopStore();
  return createRedisDesktopStore(new Redis({ url, token }), environment);
}

export function unavailableDesktopStore(): DesktopStore {
  const fail = async (): Promise<never> => {
    throw new DesktopStoreUnavailable();
  };
  return {
    savePending: fail,
    readInvitation: fail,
    approve: fail,
    claim: fail,
    readSession: fail,
    revokeSession: fail,
    revokeDevice: fail,
    listDevices: fail,
    consumeRate: fail,
  };
}

interface MemoryEntry<T> {
  value: T;
  expiresAt: number;
}

export function createMemoryDesktopStore(now: () => number, environment: DesktopEnvironment): DesktopStore {
  const pending = new Map<string, MemoryEntry<PendingRecord>>();
  const users = new Map<string, MemoryEntry<string>>();
  const sessions = new Map<string, MemoryEntry<SessionRecord>>();
  const devices = new Map<string, MemoryEntry<DeviceRecord>>();
  const admins = new Map<string, Set<string>>();
  const rates = new Map<string, { count: number; resetAt: number }>();

  function live<T>(map: Map<string, MemoryEntry<T>>, key: string): T | null {
    const entry = map.get(key);
    if (!entry || entry.expiresAt <= now()) {
      map.delete(key);
      return null;
    }
    return entry.value;
  }

  return {
    async savePending(deviceHash, record, ttlSeconds) {
      if (record.environment !== environment) return "conflict";
      if (live(pending, deviceHash) || live(users, record.userCodeHash)) return "conflict";
      const expiresAt = now() + ttlSeconds * 1000;
      pending.set(deviceHash, { value: record, expiresAt });
      users.set(record.userCodeHash, { value: deviceHash, expiresAt });
      return "ok";
    },
    async readInvitation(userCodeHash) {
      const deviceHash = live(users, userCodeHash);
      if (!deviceHash) return null;
      const record = live(pending, deviceHash);
      if (!record || record.status !== "pending" || record.environment !== environment) return null;
      if (expiryState(record.expiresAt, now()) !== "open") return null;
      return { deviceName: record.deviceName, environment: record.environment, status: record.status };
    },
    async approve(userCodeHash, adminId, expectedEnvironment) {
      const deviceHash = live(users, userCodeHash);
      if (!deviceHash) return "missing";
      const record = live(pending, deviceHash);
      if (!record || record.status !== "pending" || record.environment !== expectedEnvironment) return "missing";
      if (expiryState(record.expiresAt, now()) !== "open") return "missing";
      const current = pending.get(deviceHash);
      if (!current) return "missing";
      pending.set(deviceHash, { ...current, value: { ...record, status: "approved", adminId } });
      users.delete(userCodeHash);
      return "ok";
    },
    async claim(deviceHash, challenge, tokenHash, ttlSeconds, expiresAt, createdAt) {
      const record = live(pending, deviceHash);
      if (!record) return "missing";
      if (!fixedEqual(record.challenge, challenge) || record.environment !== environment) return "rejected";
      const expiry = expiryState(record.expiresAt, now());
      if (expiry === "corrupt") throw new DesktopStoreUnavailable();
      if (expiry === "expired") return "missing";
      if (record.status !== "approved" || !record.adminId) return "pending";
      pending.delete(deviceHash);
      users.delete(record.userCodeHash);
      if (live(sessions, tokenHash)) return "rejected";
      const session: SessionRecord = {
        adminId: record.adminId,
        deviceId: record.deviceId,
        deviceName: record.deviceName,
        environment: record.environment,
        expiresAt,
      };
      const expiresMs = now() + ttlSeconds * 1000;
      sessions.set(tokenHash, { value: session, expiresAt: expiresMs });
      devices.set(record.deviceId, {
        value: {
          adminId: record.adminId,
          deviceId: record.deviceId,
          deviceName: record.deviceName,
          environment: record.environment,
          sessionTokenHash: tokenHash,
          createdAt,
          expiresAt,
        },
        expiresAt: expiresMs,
      });
      const owned = admins.get(record.adminId) ?? new Set<string>();
      owned.add(record.deviceId);
      admins.set(record.adminId, owned);
      return "issued";
    },
    async readSession(tokenHash) {
      const session = live(sessions, tokenHash);
      if (!session || session.environment !== environment) return null;
      const expiry = expiryState(session.expiresAt, now());
      if (expiry === "corrupt") throw new DesktopStoreUnavailable();
      return expiry === "open" ? session : null;
    },
    async revokeSession(tokenHash) {
      const session = live(sessions, tokenHash);
      if (!session) return "missing";
      const device = live(devices, session.deviceId);
      if (!device || device.sessionTokenHash !== tokenHash) return "missing";
      sessions.delete(tokenHash);
      devices.delete(session.deviceId);
      admins.get(session.adminId)?.delete(session.deviceId);
      return "ok";
    },
    async revokeDevice(adminId, deviceId) {
      const device = live(devices, deviceId);
      if (!device || device.adminId !== adminId) return "missing";
      devices.delete(deviceId);
      sessions.delete(device.sessionTokenHash);
      admins.get(adminId)?.delete(deviceId);
      return "ok";
    },
    async listDevices(adminId) {
      const ids = [...(admins.get(adminId) ?? [])];
      return ids.flatMap((id) => {
        const device = live(devices, id);
        return device?.adminId === adminId ? [device] : [];
      });
    },
    async consumeRate(bucket, limit, windowSeconds) {
      const current = rates.get(bucket);
      if (!current || current.resetAt <= now()) {
        rates.set(bucket, { count: 1, resetAt: now() + windowSeconds * 1000 });
        return true;
      }
      if (current.count >= limit) return false;
      current.count += 1;
      return true;
    },
  };
}

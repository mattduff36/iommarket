import { Redis } from "@upstash/redis";
import { z } from "zod";
import type { DesktopEnvironment } from "./desktop-config";

export const LAUNCH_TTL_SECONDS = 90;
export const launchJobIds = z.array(z.string().regex(/^[a-z0-9]{8,40}$/)).min(1).max(100)
  .refine(ids => new Set(ids).size === ids.length);
const recordSchema = z.object({
  adminId: z.string().regex(/^c[a-z0-9]{24,32}$/), environment: z.enum(["preview", "production"]),
  launchId: z.string().uuid(), mode: z.enum(["open", "task"]),
  jobIds: z.array(z.string().regex(/^[a-z0-9]{8,40}$/)).max(100), expiresAt: z.number().int(),
}).strict().refine(value => value.mode === "task" ? launchJobIds.safeParse(value.jobIds).success : value.jobIds.length === 0);
export type LaunchRecord = z.infer<typeof recordSchema>;
export interface DesktopLaunchStore {
  put(hash: string, record: LaunchRecord): Promise<boolean>;
  take(hash: string): Promise<LaunchRecord | null>;
}

export function createLaunchStore(env: Record<string, string | undefined>, environment: DesktopEnvironment): DesktopLaunchStore {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url?.startsWith("https://") || !token) throw new Error("Launch service unavailable.");
  const redis = new Redis({ url, token });
  const key = (hash: string) => {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid launch key.");
    return `itrader:stock-worker:${environment}:launch:${hash}`;
  };
  return {
    async put(hash, record) {
      return await redis.set(key(hash), recordSchema.parse(record), { ex: LAUNCH_TTL_SECONDS, nx: true }) === "OK";
    },
    async take(hash) {
      // GETDEL is atomic: concurrent redemption can issue at most one session.
      const raw = await redis.getdel(key(hash));
      if (!raw) return null;
      const parsed = recordSchema.safeParse(typeof raw === "string" ? JSON.parse(raw) : raw);
      return parsed.success && parsed.data.environment === environment ? parsed.data : null;
    },
  };
}

export function memoryLaunchStore(now: () => number): DesktopLaunchStore {
  const records = new Map<string, LaunchRecord>();
  return {
    async put(hash, record) {
      if (records.has(hash)) return false;
      records.set(hash, recordSchema.parse(record)); return true;
    },
    async take(hash) {
      const record = records.get(hash); records.delete(hash);
      return record && record.expiresAt > now() ? record : null;
    },
  };
}

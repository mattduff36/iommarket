import { db } from "@/lib/db";

export { SETTING_KEYS } from "./setting-keys";

let cachedSettings: Map<string, unknown> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000;

async function loadSettings(): Promise<Map<string, unknown>> {
  const now = Date.now();
  if (cachedSettings && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedSettings;
  }

  const rows = await db.siteSetting.findMany();
  const map = new Map<string, unknown>();
  for (const row of rows) {
    map.set(row.key, row.value);
  }
  cachedSettings = map;
  cacheTimestamp = now;
  return map;
}

export function invalidateSettingsCache() {
  cachedSettings = null;
  cacheTimestamp = 0;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const settings = await loadSettings();
  const value = settings.get(key);
  if (value === undefined || value === null) return fallback;
  return value as T;
}

export async function getNumberSetting(key: string, fallback: number): Promise<number> {
  const val = await getSetting(key, fallback);
  const n = Number(val);
  return Number.isNaN(n) ? fallback : n;
}

export async function getStringSetting(key: string, fallback: string): Promise<string> {
  const val = await getSetting(key, fallback);
  return typeof val === "string" ? val : fallback;
}

export async function getBoolSetting(key: string, fallback: boolean): Promise<boolean> {
  const val = await getSetting(key, fallback);
  return typeof val === "boolean" ? val : fallback;
}

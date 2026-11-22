import { asRecord } from "../json";

/** Decode the public Nuxt devalue table, without executing page scripts. */
export function nuxtRecords(html: string): Record<string, unknown>[] {
  const json = html.match(/<script\b[^>]*id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!json) throw new Error("Public Nuxt stock data is missing");
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error("Invalid Nuxt stock data");
  const table: unknown[] = parsed;
  const cache = new Map<number, unknown>();
  function decode(index: number): unknown {
    if (index < 0) return null;
    if (!Number.isInteger(index) || index >= table.length) throw new Error("Invalid Nuxt reference");
    if (cache.has(index)) return cache.get(index);
    const value = table[index];
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      cache.set(index, result);
      for (const entry of value) result.push(typeof entry === "number" ? decode(entry) : entry);
      return result;
    }
    const result: Record<string, unknown> = Object.create(null);
    cache.set(index, result);
    for (const [key, reference] of Object.entries(value)) {
      if (typeof reference !== "number") throw new Error("Invalid Nuxt field");
      result[key] = decode(reference);
    }
    return result;
  }
  return table.map((_, index) => asRecord(decode(index))).filter((item): item is Record<string, unknown> => Boolean(item));
}

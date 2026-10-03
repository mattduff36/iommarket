import type { MetadataRoute } from "next";

export const SITEMAP_PAGE_SIZE = 1000;
export const SITEMAP_PARTITION_SIZE = 5000;

export function sitemapPartitionIds(total: number, size = SITEMAP_PARTITION_SIZE): string[] {
  if (!Number.isInteger(total) || total <= 0) return [];
  const count = Math.ceil(total / size);
  return Array.from({ length: count }, (_, index) => String(index));
}

export function sliceSitemapPartition<T>(
  entries: readonly T[],
  partitionId: string,
  size = SITEMAP_PARTITION_SIZE,
): T[] {
  if (!/^\d+$/.test(partitionId)) return [];
  const id = Number(partitionId);
  const start = id * size;
  if (start >= entries.length) return [];
  return entries.slice(start, start + size);
}

export function dedupeSitemapEntries(
  entries: readonly MetadataRoute.Sitemap[number][],
): MetadataRoute.Sitemap {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.url)) return false;
    seen.add(entry.url);
    return true;
  });
}

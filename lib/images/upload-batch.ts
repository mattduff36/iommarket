/** Bound network/decoding pressure while preserving selection order, not completion order. */
export async function mapPhotoBatch<T, R>(items: readonly T[], process: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await process(items[index]);
    }
  }));
  return results;
}

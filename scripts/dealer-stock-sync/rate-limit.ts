export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withDelay<T>(ms: number, run: () => Promise<T>) {
  const result = await run();
  if (ms > 0) await sleep(ms);
  return result;
}

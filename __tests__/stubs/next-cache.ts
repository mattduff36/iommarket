export function revalidatePath() {}
export function revalidateTag() {}
export function updateTag() {}
export function refresh() {}
export function unstable_noStore() {}
export function cacheLife() {}
export function cacheTag() {}
export function io() {}
export function unstable_cache<T extends (...args: never[]) => unknown>(fn: T) {
  return fn;
}
export const unstable_cacheLife = cacheLife;
export const unstable_cacheTag = cacheTag;

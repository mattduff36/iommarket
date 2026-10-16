import { PreviewMirrorError } from "./error";

export const MIRROR_INTERVAL_MS = 72 * 60 * 60 * 1000;
export const MIRROR_DEADLINE_MS = 240_000;
export const MIRROR_STATEMENT_TIMEOUT = "240s";
export const MIRROR_BYTE_BUDGET = 500 * 1024 * 1024;
export const MIRROR_LOCK_A = 176924;
export const MIRROR_LOCK_B = 20261009;

export function assertByteBudget(bytes: number, budget = MIRROR_BYTE_BUDGET): void {
  if (!Number.isFinite(bytes) || bytes < 0 || bytes > budget) {
    throw new PreviewMirrorError("The preview snapshot exceeds the size limit. Nothing was changed.");
  }
}

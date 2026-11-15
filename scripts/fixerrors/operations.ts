import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { performance } from "node:perf_hooks";

const DEFAULTS = {
  FIXERRORS_GIT_TIMEOUT_MS: 30_000, FIXERRORS_GITHUB_TIMEOUT_MS: 30_000,
  FIXERRORS_CONNECT_TIMEOUT_MS: 15_000, FIXERRORS_QUERY_TIMEOUT_MS: 60_000,
  FIXERRORS_STATEMENT_TIMEOUT_MS: 45_000, FIXERRORS_LOCK_TIMEOUT_MS: 10_000,
};

export function fixerrorsTimeouts(env: Record<string, string | undefined> = process.env) {
  return Object.fromEntries(Object.entries(DEFAULTS).map(([key, fallback]) => {
    const raw = env[key];
    const value = raw === undefined ? fallback : /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(value) || value < 1 || value > 600_000) {
      throw new Error(`${key} must be an integer between 1 and 600000 milliseconds`);
    }
    return [key, value];
  })) as Record<keyof typeof DEFAULTS, number>;
}

const timings = new Map<string, { calls: number; failed: number; durationMs: number }>();
function recordTiming(label: string, start: number, failed: boolean) {
  const before = timings.get(label) ?? { calls: 0, failed: 0, durationMs: 0 };
  timings.set(label, { calls: before.calls + 1, failed: before.failed + Number(failed), durationMs: before.durationMs + performance.now() - start });
}

export function stageTimings() {
  return [...timings].map(([stage, value]) => ({ stage, ...value, durationMs: Math.round(value.durationMs) }));
}

export async function timeStage<T>(label: string, run: () => Promise<T>, log: (message: string) => void = console.error): Promise<T> {
  const start = performance.now();
  try {
    const result = await run();
    recordTiming(label, start, false);
    log(`[fixerrors] ${label}: completed in ${Math.round(performance.now() - start)}ms`);
    return result;
  } catch (error) {
    recordTiming(label, start, true);
    log(`[fixerrors] ${label}: failed after ${Math.round(performance.now() - start)}ms`);
    throw error;
  }
}

export function runBoundedProcess(command: string, args: string[], options: Omit<SpawnSyncOptionsWithStringEncoding, "encoding"> & { timeout: number; label: string }) {
  const { label, ...spawnOptions } = options;
  const start = performance.now();
  const result = spawnSync(command, args, { ...spawnOptions, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  recordTiming(label, start, result.status !== 0);
  if (result.error) {
    const code = "code" in result.error ? result.error.code : undefined;
    throw new Error(`${label} ${code === "ETIMEDOUT" ? `timed out after ${options.timeout}ms` : "could not complete"}; no automatic retry was attempted`, { cause: result.error });
  }
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

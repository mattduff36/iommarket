import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { DatabaseSyncError } from "./snapshot";

export type SyncOperationSide = "source" | "destination" | "cleanup";

export type SyncTrace = {
  referenceId: string;
  startedAt: number;
  phase: string;
  subphase: string;
  operation: SyncOperationSide;
  table?: string;
};

export type SanitizedSyncError = {
  name: string;
  message: string;
  code?: string;
};

const SECRET_TEXT = /postgres(?:ql)?:\/\/\S+|password=[^\s&'"]+|authorization:\s*\S+|bearer\s+\S+/gi;
const LONG_SECRET = /\b(?:[A-Za-z0-9+/]{40,}={0,2}|[a-f0-9]{32,})\b/gi;

export function createSyncTrace(phase: string): SyncTrace {
  return {
    referenceId: randomUUID(),
    startedAt: Date.now(),
    phase,
    subphase: phase,
    operation: "destination",
  };
}

export function deployCommit(env: NodeJS.ProcessEnv): string {
  const commit = env.VERCEL_GIT_COMMIT_SHA?.trim();
  return commit && /^[a-f0-9]{7,40}$/i.test(commit) ? commit : "unknown";
}

export function sanitizeSyncError(error: unknown): SanitizedSyncError {
  const record = error && typeof error === "object" ? error as { name?: unknown; message?: unknown; code?: unknown } : undefined;
  const code = typeof record?.code === "string" && /^(?:[0-9A-Z]{5}|[A-Z][A-Z0-9_]{1,48})$/.test(record.code)
    ? record.code
    : undefined;
  const raw = typeof record?.message === "string" ? record.message : "Unexpected failure";
  const message = raw.replace(SECRET_TEXT, "[redacted]").replace(LONG_SECRET, "[redacted]").replace(/\s+/g, " ").slice(0, 300);
  return {
    name: typeof record?.name === "string" ? record.name.slice(0, 80) : "Error",
    message,
    code,
  };
}

export function logSyncFailure(trace: SyncTrace, error: unknown, env: NodeJS.ProcessEnv = process.env) {
  const sanitized = sanitizeSyncError(error);
  console.error("Database sync failure.", {
    referenceId: trace.referenceId,
    commit: deployCommit(env),
    phase: trace.phase,
    subphase: trace.subphase,
    operation: trace.operation,
    table: trace.table,
    elapsedMs: Date.now() - trace.startedAt,
    code: sanitized.code,
    message: sanitized.message,
  });
}

function contractMessage(error: unknown): string | null {
  if (!(error instanceof Error) || error instanceof DatabaseSyncError) return null;
  return /^(?:Production source role|Database role|Required )/.test(error.message) ? error.message : null;
}

export function reportPrepareFailure(trace: SyncTrace, error: unknown, env: NodeJS.ProcessEnv = process.env): DatabaseSyncError {
  if (error instanceof DatabaseSyncError) return error;
  logSyncFailure(trace, error, env);
  const contract = contractMessage(error);
  const message = contract
    ? `${contract} Reference ${trace.referenceId}.`
    : `Plan preparation failed during ${trace.phase}. Reference ${trace.referenceId}. No development data was changed.`;
  const wrapped = new DatabaseSyncError(message);
  wrapped.cause = error;
  return wrapped;
}

export async function rollbackWithoutReplacing(client: PoolClient, trace: SyncTrace, env: NodeJS.ProcessEnv = process.env) {
  try {
    await client.query("ROLLBACK");
  } catch (error) {
    const cleanup = { ...trace, operation: "cleanup" as const, subphase: `${trace.subphase}.rollback` };
    logSyncFailure(cleanup, error, env);
  }
}

export async function closeWithoutReplacing(work: () => Promise<void> | void, trace: SyncTrace, env: NodeJS.ProcessEnv = process.env) {
  try {
    await work();
  } catch (error) {
    logSyncFailure({ ...trace, operation: "cleanup", subphase: `${trace.subphase}.close` }, error, env);
  }
}

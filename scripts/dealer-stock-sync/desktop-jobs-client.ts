import { DESKTOP_ORIGINS, type DesktopEnvironment } from "./desktop-access";

export const DESKTOP_REQUEST_TIMEOUT_MS = 60_000;
export const DESKTOP_STEP_TIMEOUT_MS = 240_000;
export const DESKTOP_REQUEST_INTERVAL_MS = 1_200;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 65_536;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const JOB_ID = /^[a-z0-9]{8,40}$/;

function isJsonUtf8(header: string | null): boolean {
  if (!header) return false;
  const [type, ...params] = header.split(";").map(part => part.trim());
  if (type.toLowerCase() !== "application/json") return false;
  return params.every(part => {
    if (!part) return true;
    const separator = part.indexOf("=");
    if (separator === -1) return false;
    const name = part.slice(0, separator).trim().toLowerCase();
    const charset = part.slice(separator + 1).trim().replace(/^"|"$/g, "").toLowerCase();
    return name === "charset" && charset === "utf-8";
  });
}

export interface DesktopLease { id: string; kind: "SCRAPE" | "APPLY"; registryKey: string; leaseToken: string }
export type DesktopTerminal = "succeeded" | "failed";
export type DesktopFailureReason = "source_unavailable" | "browser_failed" | "timed_out" | "incomplete";
export class DesktopJobError extends Error {
  constructor(readonly reason: "unauthorised" | "unavailable" | "invalid-response" | "invalid-request" | "conflict" | "rate-limited" | "job-failed") {
    super(reason === "unauthorised" ? "Desktop authorisation has expired or been revoked. Sign in again."
      : reason === "job-failed" ? "The stock job failed. Check Stock Reviews before starting again."
      : reason === "rate-limited" ? "iTrader asked this device to pause. Wait a minute before starting again."
      : reason === "conflict" ? "The job lease is no longer available. Check Stock Reviews before starting again."
      : "The iTrader request could not be verified. Check Stock Reviews before starting again; the last request may have completed.");
    this.name = "DesktopJobError";
  }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DesktopJobError("invalid-response");
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new DesktopJobError("invalid-response");
  }
}
function status(value: unknown, allowed: readonly string[]): string {
  const body = record(value);
  exact(body, ["status"]);
  if (typeof body.status !== "string" || !allowed.includes(body.status)) throw new DesktopJobError("invalid-response");
  return body.status;
}

export function createDesktopJobsClient(environment: DesktopEnvironment, accessToken: string, options: {
  fetcher?: typeof fetch; now?: () => number; wait?: (ms: number) => Promise<void>; timeoutMs?: number;
} = {}) {
  if ((environment !== "preview" && environment !== "production") || typeof accessToken !== "string" || !TOKEN.test(accessToken)) {
    throw new DesktopJobError("unauthorised");
  }
  const url = DESKTOP_ORIGINS[environment] + "/api/stock-worker/jobs";
  const now = options.now ?? Date.now;
  const wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let lastStarted = Number.NEGATIVE_INFINITY;
  let queue = Promise.resolve();

  function scheduled<T>(work: () => Promise<T>, beforeSend?: () => boolean, stopped?: T): Promise<T> {
    const task = queue.then(async () => {
      const remaining = DESKTOP_REQUEST_INTERVAL_MS - (now() - lastStarted);
      if (remaining > 0) await wait(remaining);
      lastStarted = now();
      if (beforeSend?.()) return stopped as T;
      return work();
    });
    queue = task.then(() => undefined, () => undefined);
    return task;
  }

  async function post(body: Record<string, unknown>): Promise<unknown> {
    let encoded: string;
    try { encoded = JSON.stringify(body); }
    catch { throw new DesktopJobError("invalid-request"); }
    if (Buffer.byteLength(encoded, "utf8") > MAX_REQUEST_BYTES) throw new DesktopJobError("invalid-request");
    const limit = body.op === "step" ? DESKTOP_STEP_TIMEOUT_MS : DESKTOP_REQUEST_TIMEOUT_MS;
    const timeout = Math.max(1, Math.min(limit, options.timeoutMs ?? limit));
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        void reader?.cancel().catch(() => undefined);
        reject(new DesktopJobError("unavailable"));
      }, timeout);
    });
    try {
      return await Promise.race([deadline, (async () => {
        const response = await (options.fetcher ?? fetch)(url, {
          method: "POST", redirect: "error", cache: "no-store", credentials: "omit", signal: controller.signal,
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken }, body: encoded,
        });
        if (response.status === 401 || response.status === 403) throw new DesktopJobError("unauthorised");
        if (response.status === 409) throw new DesktopJobError("conflict");
        if (response.status === 429) throw new DesktopJobError("rate-limited");
        if (response.status === 400) throw new DesktopJobError("invalid-request");
        if (!response.ok || response.redirected || (response.url && response.url !== url)) throw new DesktopJobError("unavailable");
        if (!isJsonUtf8(response.headers.get("content-type")) || !response.body) throw new DesktopJobError("invalid-response");
        reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > MAX_RESPONSE_BYTES) throw new DesktopJobError("invalid-response");
          chunks.push(chunk.value);
        }
        let decoded: string;
        try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
        catch { throw new DesktopJobError("invalid-response"); }
        try { return JSON.parse(decoded) as unknown; }
        catch { throw new DesktopJobError("invalid-response"); }
      })()]);
    } catch (error) {
      if (error instanceof DesktopJobError) throw error;
      throw new DesktopJobError("unavailable");
    } finally {
      clearTimeout(timer);
      controller.abort();
      void reader?.cancel().catch(() => undefined);
    }
  }

  const receipt = (job: DesktopLease) => ({ jobId: job.id, leaseToken: job.leaseToken });
  return {
    check: () => scheduled(async () => {
      const body = record(await post({ op: "check" }));
      exact(body, ["ready"]);
      if (body.ready !== true) throw new DesktopJobError("invalid-response");
    }),
    lease: (isStopped: () => boolean = () => false): Promise<DesktopLease | null> => scheduled(async () => {
      const body = record(await post({ op: "lease" }));
      exact(body, ["job"]);
      if (body.job === null) return null;
      const job = record(body.job);
      exact(job, ["id", "kind", "registryKey", "leaseToken"]);
      if (typeof job.id !== "string" || !JOB_ID.test(job.id) || (job.kind !== "SCRAPE" && job.kind !== "APPLY") ||
          typeof job.registryKey !== "string" || !/^[a-z0-9-]{1,80}$/.test(job.registryKey) ||
          typeof job.leaseToken !== "string" || !TOKEN.test(job.leaseToken)) throw new DesktopJobError("invalid-response");
      return job as unknown as DesktopLease;
    }, isStopped, null),
    heartbeat: (job: DesktopLease) => scheduled(async () => {
      status(await post({ op: "heartbeat", ...receipt(job) }), ["extended"]);
    }),
    submit: (job: DesktopLease, result: unknown) => scheduled(async () =>
      status(await post({ op: "submit", ...receipt(job), result }), ["succeeded", "failed"]) as DesktopTerminal),
    fail: (job: DesktopLease, reason: DesktopFailureReason) => scheduled(async () =>
      status(await post({ op: "fail", ...receipt(job), reason }), ["failed"]) as "failed"),
    step: (job: DesktopLease) => scheduled(async () =>
      status(await post({ op: "step", ...receipt(job) }), ["continue", "succeeded", "failed"]) as DesktopTerminal | "continue"),
  };
}
export type DesktopJobsClient = ReturnType<typeof createDesktopJobsClient>;

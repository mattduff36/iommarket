import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Readable } from "node:stream";
import {
  assertDatabaseCertificate, assertImageKitReady, assertRuntimeReady,
  assertSelectedTarget, buildIsolatedEnv,
} from "./pc-launcher";
import { managedMediaScope } from "../../lib/media/managed-policy";
import { buildDatabasePoolOptions } from "../../lib/db/pool-options";
import { authoriseDesktopSession, DESKTOP_ORIGINS, DesktopAccessError, type DesktopEnvironment } from "./desktop-access";

const MAX_BOOTSTRAP_BYTES = 65_536;
const ALLOWED_CONFIG_KEYS = new Set([
  "DEALER_STOCK_SYNC_TARGET", "VERCEL_ENV", "ITRADER_DEPLOYMENT_ROLE", "NODE_ENV",
  "DEALER_STOCK_SYNC_WORKER", "DEALER_STOCK_SYNC_PRODUCTION_ENABLED",
  "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SUPABASE_URL", "DATABASE_URL", "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING", "SUPABASE_DB_CA_CERT", "MEDIA_PROVIDER",
  "NEXT_PUBLIC_MEDIA_PROVIDER", "MEDIA_UPLOAD_PROVIDER", "IMAGEKIT_UPLOADS_ENABLED",
  "IMAGEKIT_URL_ENDPOINT", "IMAGEKIT_PUBLIC_KEY", "IMAGEKIT_PRIVATE_KEY",
]);

export interface DesktopBootstrap {
  environment: DesktopEnvironment;
  accessToken: string;
  config: Record<string, string>;
}

export function parseDesktopMode(argv: readonly string[]): "check" | "watch" {
  if (argv.length !== 2 || argv[0] !== "--mode" || (argv[1] !== "check" && argv[1] !== "watch")) {
    throw new Error("Choose a connection check or manual worker mode.");
  }
  return argv[1];
}

export function validateDesktopBootstrap(value: unknown): DesktopBootstrap {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid desktop configuration.");
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== 3 || !["environment", "accessToken", "config"].every((key) => key in data) ||
      (data.environment !== "preview" && data.environment !== "production") ||
      typeof data.accessToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(data.accessToken) ||
      !data.config || typeof data.config !== "object" || Array.isArray(data.config)) {
    throw new Error("Invalid desktop configuration.");
  }
  const config: Record<string, string> = {};
  for (const [key, entry] of Object.entries(data.config)) {
    if (!ALLOWED_CONFIG_KEYS.has(key) || typeof entry !== "string" || entry.length > 16_000 || entry.includes("\0")) {
      throw new Error("Invalid desktop configuration.");
    }
    if (entry.trim()) config[key] = entry;
  }
  if (config.NODE_ENV !== "production" || config.NEXT_PUBLIC_APP_URL !== DESKTOP_ORIGINS[data.environment]) {
    throw new Error("The selected site does not match the configuration.");
  }
  assertSelectedTarget(data.environment, config);
  assertDatabaseCertificate(config);
  assertImageKitReady(config);
  if (managedMediaScope(config as NodeJS.ProcessEnv) !== (data.environment === "preview" ? "staging" : "production")) {
    throw new Error("The selected image destination does not match the site.");
  }
  return { environment: data.environment, accessToken: data.accessToken, config };
}

/** One bounded, newline-terminated frame. The pipe stays open for safe-stop EOF. */
export function readDesktopBootstrap(input: Readable, timeoutMs = 15_000): Promise<unknown> {
  return new Promise((accept, reject) => {
    let bytes = Buffer.alloc(0);
    let settled = false;
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.off("data", onData);
      input.off("end", onEnd);
      input.off("error", onError);
      if (error) reject(error); else accept(value);
    };
    const onEnd = () => finish(new Error("The desktop control window was closed."));
    const onError = () => finish(new Error("The desktop control connection failed."));
    const onData = (chunk: Buffer | string) => {
      bytes = Buffer.concat([bytes, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      if (bytes.length > MAX_BOOTSTRAP_BYTES) return finish(new Error("Desktop configuration is too large."));
      const end = bytes.indexOf(10);
      if (end < 0) return;
      try {
        finish(undefined, JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end))));
      } catch { finish(new Error("Invalid desktop configuration.")); }
    };
    const timer = setTimeout(() => finish(new Error("The desktop control window did not send configuration.")), timeoutMs);
    input.once("end", onEnd);
    input.once("error", onError);
    input.on("data", onData);
    if (input.readableEnded || input.destroyed) onEnd();
  });
}

export interface DesktopEvent {
  type: "status" | "job" | "error" | "check";
  state: string;
  message: string;
  jobId?: string;
}

/** Never interpret 'finished processing' as proof that changes were applied. */
export function workerLineEvent(line: string): DesktopEvent | null {
  const start = /^Processing job ([A-Za-z0-9_-]{1,128})\./.exec(line);
  if (start) return { type: "job", state: "processing", jobId: start[1], message: "Processing a queued stock job." };
  const end = /^Finished processing job ([A-Za-z0-9_-]{1,128})\./.exec(line);
  if (end) return { type: "job", state: "processing-finished", jobId: end[1], message: "Processing finished. Check the result in iTrader before continuing." };
  if (line.startsWith("Waiting for")) return { type: "status", state: "waiting", message: "Waiting for queued jobs. Weekly scheduling is off." };
  if (line.startsWith("Stopping after")) return { type: "status", state: "stopping", message: "Stopping after the current job finishes." };
  if (line.startsWith("Dealer stock worker ready")) return { type: "status", state: "ready", message: "Manual worker ready. Already queued jobs may be processed." };
  if (line.startsWith("Dealer stock worker stopped")) return { type: "status", state: "stopped", message: "Worker stopped." };
  return null;
}

async function readiness(isStopped: () => boolean) {
  const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(workerRoot, "../browsers");
  const { chromium } = await import("@playwright/test");
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major === 22 && minor < 12) throw new Error("The bundled Node.js runtime is too old.");
  assertRuntimeReady({
    nodeVersion: process.versions.node,
    tsxInstalled: existsSync(resolve(workerRoot, "node_modules/tsx/package.json")),
    chromiumInstalled: existsSync(chromium.executablePath()),
  });
  if (isStopped()) return;
  const { default: pg } = await import("pg");
  const connection = process.env.POSTGRES_URL ?? process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL;
  if (!connection) throw new Error("Database connection is missing.");
  const client = new pg.Client({
    ...buildDatabasePoolOptions(connection), connectionTimeoutMillis: 15_000,
    query_timeout: 15_000, statement_timeout: 15_000,
  });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    // No rows are read or altered; this checks connectivity and stock-table access.
    await client.query('SELECT 1 FROM "DealerStockSyncJob" WHERE false');
    await client.query("ROLLBACK");
  } finally { await client.end().catch(() => undefined); }
  if (isStopped()) return;
  const browser = await chromium.launch({ headless: true, timeout: 30_000 });
  try {
    const page = await browser.newPage();
    await page.setContent("<html><head><title>iTrader readiness</title></head><body>Local check</body></html>");
    if (await page.title() !== "iTrader readiness") throw new Error("Bundled browser check failed.");
  } finally { await browser.close(); }
  if (isStopped()) return;
  const { default: sharp } = await import("sharp");
  const result = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>')).png().toBuffer();
  if (!result.length) throw new Error("Image processing check failed.");
}

export async function runDesktop(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const emit = (event: DesktopEvent) => process.stdout.write(`${JSON.stringify(event)}\n`);
  let stopped = process.stdin.readableEnded || process.stdin.destroyed;
  const onEnd = () => { stopped = true; };
  process.stdin.on("end", onEnd);
  process.stdin.on("error", onEnd);
  process.stdin.on("close", onEnd);
  try {
    const mode = parseDesktopMode(argv);
    const bootstrap = validateDesktopBootstrap(await readDesktopBootstrap(process.stdin));
    if (stopped) return 0;
    const isolated = buildIsolatedEnv(process.env, bootstrap.config);
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, isolated);
    const authorise = () => authoriseDesktopSession(bootstrap.environment, bootstrap.accessToken).then(() => undefined);
    emit({ type: "status", state: "checking", message: "Checking authorisation and the installed runtime." });
    await authorise();
    if (stopped) return 0;
    await readiness(() => stopped);
    if (stopped) return 0;
    emit({ type: "check", state: "passed", message: "Database, bundled browser and image processing checked. No stock jobs or uploads were run." });
    if (mode === "check") return 0;
    const { runWorker } = await import("./worker-cli");
    await runWorker(["--watch", "--manual"], {
      authorise,
      isStopped: () => stopped,
      write: (line) => { const event = workerLineEvent(line); if (event) emit(event); },
    });
    return 0;
  } catch (error) {
    if (stopped) return 0;
    emit({
      type: "error", state: error instanceof DesktopAccessError ? error.reason : "failed",
      message: error instanceof DesktopAccessError ? error.message : "Worker checks or processing failed. Review the installation, connection and iTrader job result.",
    });
    return 1;
  } finally {
    process.stdin.off("end", onEnd);
    process.stdin.off("error", onEnd);
    process.stdin.off("close", onEnd);
    process.stdin.pause();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  runDesktop().then((code) => { process.exitCode = code; });
}

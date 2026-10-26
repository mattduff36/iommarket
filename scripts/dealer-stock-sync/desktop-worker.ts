import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Readable } from "node:stream";
import type { DesktopEnvironment } from "./desktop-access";
import { createDesktopJobsClient, DesktopJobError } from "./desktop-jobs-client";
import { runDesktopWatch, type DesktopEvent } from "./desktop-job-runner";

const MAX_BOOTSTRAP_BYTES = 65_536;
const OS_ENV_KEYS = [
  "PATHEXT", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
  "COMSPEC", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "OS",
  "USERNAME", "USERDOMAIN", "SYSTEMDRIVE",
] as const;
export interface DesktopBootstrap { environment: DesktopEnvironment; accessToken: string }

export function parseDesktopMode(argv: readonly string[]): "check" | "watch" {
  if (argv.length !== 2 || argv[0] !== "--mode" || (argv[1] !== "check" && argv[1] !== "watch")) {
    throw new Error("Choose a connection check or manual worker mode.");
  }
  return argv[1];
}

export function validateDesktopBootstrap(value: unknown): DesktopBootstrap {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid desktop sign-in.");
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== 2 || !["environment", "accessToken"].every(key => Object.hasOwn(data, key)) ||
      (data.environment !== "preview" && data.environment !== "production") ||
      typeof data.accessToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(data.accessToken)) {
    throw new Error("Invalid desktop sign-in.");
  }
  return { environment: data.environment, accessToken: data.accessToken };
}

/** The native launcher also isolates the environment before Node/tsx can execute. */
export function desktopRuntimeEnvironment(parent: Readonly<Record<string, string | undefined>>, nodePath = process.execPath): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const key of OS_ENV_KEYS) {
    const entry = Object.entries(parent).find(([name]) => name.toUpperCase() === key)?.[1];
    if (entry && entry.length < 32_768 && !entry.includes("\0")) result[key] = entry;
  }
  result.PATH = [dirname(nodePath), ...(result.SYSTEMROOT ? [resolve(result.SYSTEMROOT, "System32"), result.SYSTEMROOT] : [])].join(";");
  return result;
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
      if (bytes.length > MAX_BOOTSTRAP_BYTES) return finish(new Error("Desktop sign-in is too large."));
      const end = bytes.indexOf(10);
      if (end < 0) return;
      try {
        finish(undefined, JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end))));
      } catch { finish(new Error("Invalid desktop sign-in.")); }
    };
    const timer = setTimeout(() => finish(new Error("The desktop control window did not send sign-in.")), timeoutMs);
    input.once("end", onEnd);
    input.once("error", onError);
    input.on("data", onData);
    if (input.readableEnded || input.destroyed) onEnd();
  });
}

async function readiness(isStopped: () => boolean) {
  const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(workerRoot, "../browsers");
  const { chromium } = await import("@playwright/test");
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 12) ||
      !existsSync(resolve(workerRoot, "node_modules/tsx/package.json"))) throw new Error("The installed runtime is incomplete.");
  // A headless launch uses Chromium's headless shell; executablePath() instead
  // names the optional full browser. The real launch below verifies readiness.
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
  const emit = (event: DesktopEvent) => { process.stdout.write(JSON.stringify(event) + "\n"); };
  let stopped = process.stdin.readableEnded || process.stdin.destroyed;
  const onEnd = () => {
    if (!stopped) emit({ type: "status", state: "stopping", message: "Stopping after the current job finishes." });
    stopped = true;
  };
  process.stdin.on("end", onEnd);
  process.stdin.on("error", onEnd);
  process.stdin.on("close", onEnd);
  try {
    const mode = parseDesktopMode(argv);
    const bootstrap = validateDesktopBootstrap(await readDesktopBootstrap(process.stdin));
    if (stopped) return 0;
    const isolated = desktopRuntimeEnvironment(process.env);
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, isolated);
    const client = createDesktopJobsClient(bootstrap.environment, bootstrap.accessToken);
    emit({ type: "status", state: "checking", message: "Checking authorisation and the installed runtime." });
    await client.check();
    if (stopped) return 0;
    await readiness(() => stopped);
    if (stopped) return 0;
    emit({ type: "check", state: "passed", message: "Server readiness, bundled browser and image processing checked. No jobs or uploads were run." });
    if (mode === "check") return 0;
    const [{ getDealer }, { runDealerPipeline }] = await Promise.all([import("./registry"), import("./pipeline")]);
    await runDesktopWatch({
      client, isStopped: () => stopped, emit,
      scrape: registryKey => runDealerPipeline(getDealer(registryKey)),
    });
    return 0;
  } catch (error) {
    emit({
      type: "error", state: error instanceof DesktopJobError ? error.reason : "failed",
      message: error instanceof DesktopJobError ? error.message
        : "Worker checks or processing failed. Review the installation, connection and Stock Reviews for the actual result.",
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
  runDesktop().then(code => { process.exitCode = code; });
}

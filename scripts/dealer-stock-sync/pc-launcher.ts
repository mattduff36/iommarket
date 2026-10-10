import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { parse } from "dotenv";
import { assertWorkerEnabled } from "../../lib/dealer-stock-sync/worker-guard";
import { readDatabaseCaCertificate } from "../../lib/db/pool-options";
import { mediaEnvironmentIssues } from "../../lib/media/environment-contract";
import { readMediaUploadProvider } from "../../lib/media/upload-provider";
import { managedMediaScope } from "../../lib/media/managed-policy";

export type WorkerTarget = "preview" | "production";

const WORKER_ARGS = ["--import", "tsx", "scripts/dealer-stock-sync/worker-cli.ts", "--watch", "--manual"];
const OS_ENV_NAMES = new Set([
  "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "COMSPEC", "SYSTEMDRIVE",
  "HOMEDRIVE", "HOMEPATH", "USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "PROGRAMFILES",
  "PROGRAMFILES(X86)", "PROGRAMW6432", "PROGRAMDATA", "COMMONPROGRAMFILES", "COMMONPROGRAMFILES(X86)",
  "PUBLIC", "ALLUSERSPROFILE", "DRIVERDATA", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER", "PROCESSOR_LEVEL", "PROCESSOR_REVISION", "OS", "COMPUTERNAME", "USERNAME",
  "USERDOMAIN", "LOGONSERVER", "LANG", "LC_ALL", "LC_CTYPE", "LANGUAGE", "PLAYWRIGHT_BROWSERS_PATH",
  "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
]);
const SECRET_NAME = /URL|KEY|SECRET|TOKEN|PASSWORD|CERT|DATABASE|POSTGRES|SERVICE_ROLE/i;

export interface LauncherIo {
  cwd: string;
  parentEnv: Record<string, string | undefined>;
  nodeVersion: string;
  readText: (filePath: string) => string;
  exists: (filePath: string) => boolean;
  tsxInstalled: boolean;
  chromiumInstalled: boolean;
  write: (line: string) => void;
  writeError: (line: string) => void;
  spawnWorker: (input: { cwd: string; env: Record<string, string>; args: string[] }) => Promise<number>;
}

export function parseLauncherArgs(argv: readonly string[]) {
  let target: WorkerTarget | null = null;
  let configPath: string | undefined;
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") {
      check = true;
      continue;
    }
    if (arg === "--target" || arg === "--config") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      index += 1;
      if (arg === "--target") {
        if (value !== "preview" && value !== "production") {
          throw new Error("Choose preview or production.");
        }
        target = value;
      } else {
        configPath = value;
      }
      continue;
    }
    throw new Error("Unsupported launcher argument.");
  }
  if (!target) throw new Error("Pass --target preview or --target production.");
  return { target, check, configPath };
}

export function defaultConfigPath(target: WorkerTarget, cwd: string) {
  return resolve(cwd, "private", "dealer-stock-worker", `${target}.env`);
}

export function assertConfigPathAllowed(configPath: string) {
  const name = basename(configPath).toLowerCase();
  if (name === ".env.local" || name === ".env" || name === ".env.development" || name === ".env.production") {
    throw new Error("Refusing to load an application environment file. Use private/dealer-stock-worker/<target>.env.");
  }
}

export function loadWorkerConfig(text: string): Record<string, string> {
  return parse(text);
}

export function buildIsolatedEnv(
  parent: Record<string, string | undefined>,
  fileEnv: Record<string, string>,
): Record<string, string> {
  const child: Record<string, string> = {};
  for (const [key, value] of Object.entries(parent)) {
    if (value !== undefined && OS_ENV_NAMES.has(key.toUpperCase())) child[key] = value;
  }
  for (const [key, value] of Object.entries(fileEnv)) {
    if (!key || key.includes("\0")) continue;
    child[key] = value;
  }
  return child;
}

export function assertRuntimeReady(input: { nodeVersion: string; tsxInstalled: boolean; chromiumInstalled: boolean }) {
  const major = Number(input.nodeVersion.split(".")[0]);
  if (!Number.isInteger(major) || major < 22) {
    throw new Error("Node.js 22 or newer is required. The launcher does not install it.");
  }
  if (!input.tsxInstalled) throw new Error("tsx is not installed. Run npm ci in this repository. The launcher does not install it.");
  if (!input.chromiumInstalled) {
    throw new Error("Playwright Chromium is not installed. Run npx playwright install chromium. The launcher does not install it.");
  }
}

export function assertImageKitReady(env: Record<string, string | undefined>) {
  let upload: string;
  try {
    upload = readMediaUploadProvider(env);
  } catch {
    throw new Error("ImageKit uploads are not configured.");
  }
  if (upload !== "imagekit") throw new Error("ImageKit uploads are not configured.");
  const issues = mediaEnvironmentIssues(env).filter((issue) =>
    issue.key.startsWith("IMAGEKIT_") || issue.key.startsWith("MEDIA_") || issue.key.startsWith("NEXT_PUBLIC_MEDIA_"),
  );
  if (issues.length > 0) throw new Error(`ImageKit is not ready (${issues.map((issue) => issue.key).join(", ")}).`);
}

export function assertDatabaseCertificate(env: Record<string, string | undefined>) {
  let certificate: string | null;
  try {
    certificate = readDatabaseCaCertificate(env);
  } catch {
    throw new Error("SUPABASE_DB_CA_CERT is invalid.");
  }
  if (!certificate) throw new Error("SUPABASE_DB_CA_CERT is required in the worker configuration.");
}

export function assertSelectedTarget(target: WorkerTarget, env: Record<string, string | undefined>) {
  if (env.DEALER_STOCK_SYNC_TARGET !== target) {
    throw new Error(`The configuration target does not match the selected ${target} worker.`);
  }
  const resolved = assertWorkerEnabled(env);
  if (resolved !== target) throw new Error(`The environment guard did not accept the selected ${target} worker.`);
}

export function statusLines(target: WorkerTarget, env: Record<string, string | undefined>) {
  return [
    `Dealer stock worker: ${target}`,
    `Site: ${env.NEXT_PUBLIC_APP_URL ?? "unknown"}`,
    "Weekly scrapes: off",
  ];
}

export function valuesToRedact(env: Record<string, string | undefined>) {
  return Object.entries(env).flatMap(([key, value]) => {
    if (!value || value.length < 8) return [];
    if (SECRET_NAME.test(key) || value.includes("://") || value.startsWith("private_") || value.startsWith("public_")) {
      return [value];
    }
    return [];
  });
}

export function safeErrorMessage(error: unknown, secrets: Array<string | undefined>) {
  let message = error instanceof Error && error.message ? error.message : "The stock worker could not start.";
  const sorted = [...new Set(secrets.filter((value): value is string => Boolean(value)))].sort((left, right) => right.length - left.length);
  for (const secret of sorted) {
    if (secret.length < 8) continue;
    message = message.split(secret).join("[redacted]");
  }
  return message
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://[redacted]")
    .replace(/\b(?:private|public)_[A-Za-z0-9_]+\b/g, "[redacted]");
}

export function planLaunch(argv: readonly string[], io: LauncherIo) {
  const args = parseLauncherArgs(argv);
  assertRuntimeReady(io);
  const configPath = args.configPath ? resolve(io.cwd, args.configPath) : defaultConfigPath(args.target, io.cwd);
  assertConfigPathAllowed(configPath);
  if (!io.exists(configPath)) {
    throw new Error(`Missing worker configuration: private/dealer-stock-worker/${args.target}.env`);
  }
  const fileEnv = loadWorkerConfig(io.readText(configPath));
  const env = buildIsolatedEnv(io.parentEnv, fileEnv);
  assertSelectedTarget(args.target, env);
  assertImageKitReady(env);
  assertDatabaseCertificate(env);
  const scope = managedMediaScope(env as NodeJS.ProcessEnv);
  if (scope !== (args.target === "production" ? "production" : "staging")) {
    throw new Error("The image-upload destination does not match the selected worker.");
  }
  return { ...args, env, lines: statusLines(args.target, env), fileEnv };
}

export async function runLauncher(argv: readonly string[], io: LauncherIo): Promise<number> {
  const secrets = valuesToRedact(io.parentEnv);
  try {
    const plan = planLaunch(argv, io);
    secrets.push(...valuesToRedact(plan.fileEnv));
    for (const line of plan.lines) io.write(`${line}\n`);
    if (plan.check) {
      io.write("Preflight passed. No database connection was opened.\n");
      return 0;
    }
    io.write("Starting manual watch. Leave this window open. Type Q and press Enter to stop safely.\n");
    return await io.spawnWorker({ cwd: io.cwd, env: plan.env, args: WORKER_ARGS });
  } catch (error) {
    io.writeError(`${safeErrorMessage(error, secrets)}\n`);
    return 1;
  }
}

export async function spawnWorker(input: { cwd: string; env: Record<string, string>; args: string[] }) {
  const child = spawn(process.execPath, input.args, {
    cwd: input.cwd,
    env: input.env as NodeJS.ProcessEnv,
    stdio: ["pipe", "inherit", "inherit"],
    windowsHide: false,
  });
  let announced = false;
  const stop = () => {
    if (announced) return;
    announced = true;
    process.stdout.write("Stopping after the current job finishes.\n");
    child.stdin?.end();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const consoleInput = createInterface({ input: process.stdin, terminal: false });
  consoleInput.on("line", (line) => { if (line.trim().toLowerCase() === "q") stop(); });
  try {
    return await new Promise<number>((resolvePromise, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolvePromise(code ?? 1));
    });
  } finally {
    consoleInput.close();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

async function chromiumInstalled() {
  try {
    const playwright = await import("@playwright/test");
    return existsSync(playwright.chromium.executablePath());
  } catch {
    return false;
  }
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolve(entry) === resolve(fileURLToPath(import.meta.url));
}

if (isDirectRun()) {
  chromiumInstalled().then((installed) => runLauncher(process.argv.slice(2), {
    cwd: process.cwd(),
    parentEnv: process.env,
    nodeVersion: process.versions.node,
    exists: existsSync,
    readText: (filePath) => readFileSync(filePath, "utf8"),
    tsxInstalled: existsSync(resolve(process.cwd(), "node_modules/tsx/package.json")),
    chromiumInstalled: installed,
    write: (line) => process.stdout.write(line),
    writeError: (line) => process.stderr.write(line),
    spawnWorker,
  })).then((code) => {
    process.exitCode = code;
  });
}

import { execFileSync } from "node:child_process";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { parse as parseDotenv } from "dotenv";
import { buildDatabasePoolOptions } from "../../lib/db/pool-options";
import {
  ADMIN_IDS,
  CHILD_ROLES,
  DB_TIMEOUT_MS,
  DEDICATED_PRIVATE_KEY_NAME,
  DEDICATED_PUBLIC_KEY_NAME,
  PROVISION_SQL,
  PROVISION_USAGE,
  WORKER_ROLE,
  activationStatement,
  assertAdminDatabaseUrl,
  assertAdminOption,
  assertAdmins,
  assertAliasUnchanged,
  assertChildRoles,
  assertConfiguredDatabaseProjects,
  assertDedicatedImageKit,
  assertPins,
  assertProjectMetadata,
  assertQueueEmpty,
  assertRedisMetadata,
  assertRestrictedWorker,
  assertSmoke,
  assertVercelToken,
  buildProvisionState,
  classifyProjectEnv,
  decideProvision,
  disableStatement,
  generateProvisioningPassword,
  ownEnvId,
  parseProvisionMode,
  parseProvisionState,
  prepareDesktop,
  privateTreeIgnored,
  provisioningStatePath,
  readAliasSnapshot,
  readStagingCertificate,
  vercelAliasUrl,
  vercelEnvCreateUrl,
  vercelEnvListUrl,
  vercelEnvUpdateUrl,
  vercelProjectUrl,
  vercelWriteBody,
  verifyPermissionDenied,
  type AliasSnapshot,
  type EnvClassification,
  type FailureFlags,
  type ProvisionState,
  ProvisionRefusal,
} from "../../lib/dealer-stock-sync/desktop-provisioning";
import { protectCurrentUser, restrictToCurrentUser, unprotectCurrentUser } from "./provision-state";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const IMAGEKIT_METADATA_URL = "https://api.imagekit.io/v1/files?limit=1";

interface LocalPins {
  token: string;
  certificate: string;
  privateKey: string;
  publicKey: string;
  adminDatabaseUrl: string;
  host: string;
  branch: string;
}

let localInputs: Record<string, string> = {};

function envValue(name: string): string | undefined {
  const value = localInputs[name];
  return value && value.length > 0 ? value : undefined;
}

function readText(file: string, phase: string, code: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    throw new ProvisionRefusal(phase, code);
  }
}

function collectLocalPins(): LocalPins {
  const branch = gitBranch();
  const link = readVercelLink();
  assertPins({ branch, projectId: link.projectId, teamId: link.orgId });
  if (!privateTreeIgnored(readText(path.join(repoRoot, ".gitignore"), "state", "gitignore"))) {
    throw new ProvisionRefusal("state", "gitignore");
  }
  localInputs = parseDotenv(readText(path.join(repoRoot, ".env.local"), "input", "env_local"));
  const configured = ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING"]
    .map((name) => envValue(name))
    .filter((value): value is string => Boolean(value));
  assertConfiguredDatabaseProjects(configured);
  const admin = assertAdminDatabaseUrl(envValue("POSTGRES_URL_NON_POOLING") ?? "");
  const keys = assertDedicatedImageKit({
    privateKey: envValue(DEDICATED_PRIVATE_KEY_NAME),
    publicKey: envValue(DEDICATED_PUBLIC_KEY_NAME),
    applicationPrivateKey: envValue("IMAGEKIT_PRIVATE_KEY"),
    applicationPublicKey: envValue("IMAGEKIT_PUBLIC_KEY"),
  });
  return {
    token: assertVercelToken(envValue("VERCEL_BILLING_TOKEN")),
    certificate: readStagingCertificate(envValue("SUPABASE_DB_CA_CERT")),
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
    adminDatabaseUrl: admin.url,
    host: admin.host,
    branch,
  };
}

function gitBranch(): string {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    throw new ProvisionRefusal("branch", "git");
  }
}

function readVercelLink(): { projectId: string; orgId: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readText(path.join(repoRoot, ".vercel", "project.json"), "project", "vercel_link"));
  } catch (error) {
    if (error instanceof ProvisionRefusal) throw error;
    throw new ProvisionRefusal("project", "vercel_link");
  }
  if (!parsed || typeof parsed !== "object") throw new ProvisionRefusal("project", "vercel_link");
  const record = parsed as { projectId?: unknown; orgId?: unknown };
  if (typeof record.projectId !== "string" || typeof record.orgId !== "string") {
    throw new ProvisionRefusal("project", "vercel_link");
  }
  return { projectId: record.projectId, orgId: record.orgId };
}

async function vercelRequest(token: string, url: string, method: string, body?: unknown): Promise<Response> {
  try {
    return await fetch(url, {
      method,
      redirect: "error",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(DB_TIMEOUT_MS),
    });
  } catch {
    throw new ProvisionRefusal("vercel", "network");
  }
}

async function vercelJson(token: string, url: string, phase: string): Promise<unknown> {
  const response = await vercelRequest(token, url, "GET");
  const text = await response.text().catch(() => "");
  if (!response.ok || !text) throw new ProvisionRefusal(phase, "metadata");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProvisionRefusal(phase, "metadata");
  }
}

async function discardWrite(token: string, url: string, method: string, body: unknown, code: string): Promise<void> {
  const response = await vercelRequest(token, url, method, body);
  await response.arrayBuffer().catch(() => undefined);
  if (!response.ok) throw new ProvisionRefusal("vercel_write", code);
}

async function imageKitMetadata(privateKey: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(IMAGEKIT_METADATA_URL, {
      redirect: "error",
      headers: { Authorization: `Basic ${Buffer.from(`${privateKey}:`).toString("base64")}` },
      signal: AbortSignal.timeout(DB_TIMEOUT_MS),
    });
  } catch {
    throw new ProvisionRefusal("imagekit", "metadata");
  }
  await response.arrayBuffer().catch(() => undefined);
  if (!response.ok) throw new ProvisionRefusal("imagekit", "metadata");
}

function openPool(connectionString: string, certificate: string): pg.Pool {
  const pool = new pg.Pool({
    ...buildDatabasePoolOptions(connectionString, {
      SUPABASE_DB_CA_CERT: certificate,
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
    }),
    max: 1,
    connectionTimeoutMillis: DB_TIMEOUT_MS,
    query_timeout: DB_TIMEOUT_MS,
    statement_timeout: DB_TIMEOUT_MS,
  });
  pool.on("error", () => undefined);
  return pool;
}

async function queryRows(pool: pg.Pool, sql: string, params: readonly unknown[] = []): Promise<Record<string, unknown>[]> {
  try {
    const result = await pool.query(sql, params as unknown[]);
    return result.rows as Record<string, unknown>[];
  } catch {
    throw new ProvisionRefusal("database", "query");
  }
}

async function withAdmin<T>(pins: LocalPins, fn: (pool: pg.Pool) => Promise<T>): Promise<T> {
  const pool = openPool(pins.adminDatabaseUrl, pins.certificate);
  try {
    return await fn(pool);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function readDatabase(pins: LocalPins): Promise<{ pendingJobs: number; loginEnabled: boolean }> {
  return withAdmin(pins, async (pool) => {
    const admins = await queryRows(pool, PROVISION_SQL.admins, [ADMIN_IDS]);
    assertAdmins(admins);
    const queue = await queryRows(pool, PROVISION_SQL.queue);
    const pendingJobs = assertQueueEmpty(queue[0]?.pending_jobs);
    const flags = await queryRows(pool, PROVISION_SQL.workerFlags, [WORKER_ROLE]);
    const flag = flags[0];
    if (!flag) throw new ProvisionRefusal("worker_role", "missing");
    const loginEnabled = assertRestrictedWorker(flag);
    assertChildRoles(await queryRows(pool, PROVISION_SQL.childFlags, [CHILD_ROLES]));
    assertAdminOption(await queryRows(pool, PROVISION_SQL.adminOption, [WORKER_ROLE]));
    return { pendingJobs, loginEnabled };
  });
}

async function loadState(file: string): Promise<ProvisionState | null> {
  let payload: Buffer;
  try {
    payload = await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new ProvisionRefusal("state", "read");
  }
  try {
    if (payload.length > 64_000) throw new ProvisionRefusal("state", "size");
    return parseProvisionState(await unprotectCurrentUser(payload));
  } catch (error) {
    if (error instanceof ProvisionRefusal) throw error;
    throw new ProvisionRefusal("state", "dpapi");
  }
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

async function saveState(file: string, password: string): Promise<void> {
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true });
  const parent = await realpath(directory);
  if (!samePath(parent, directory)) throw new ProvisionRefusal("state", "path");
  try {
    const blob = await protectCurrentUser(JSON.stringify(buildProvisionState(password)));
    await writeFile(file, blob, { flag: "wx", mode: 0o600 });
    await restrictToCurrentUser(file);
  } catch (error) {
    if (error instanceof ProvisionRefusal) throw error;
    throw new ProvisionRefusal("state", "dpapi");
  }
}

async function alterRole(pins: LocalPins, statement: string, phase: string): Promise<void> {
  await withAdmin(pins, async (pool) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const flags = await client.query(PROVISION_SQL.workerFlags, [WORKER_ROLE]);
      const row = flags.rows[0] as Record<string, unknown> | undefined;
      if (!row) throw new ProvisionRefusal("worker_role", "missing");
      const alreadyEnabled = assertRestrictedWorker(row);
      if (statement !== disableStatement() && alreadyEnabled) throw new ProvisionRefusal("activation", "concurrent_login");
      await client.query(statement);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (error instanceof ProvisionRefusal) throw error;
      throw new ProvisionRefusal(phase, "role");
    } finally {
      client.release();
    }
  });
}

async function probeWorker(pins: LocalPins, workerDatabaseUrl: string): Promise<void> {
  const expected = await withAdmin(pins, (pool) => queryRows(pool, PROVISION_SQL.visibility));
  const pool = openPool(workerDatabaseUrl, pins.certificate);
  let client: pg.PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const current = await client.query(PROVISION_SQL.currentUser);
    const queue = await client.query(PROVISION_SQL.queue);
    const visible = await client.query(PROVISION_SQL.visibility);
    if (!expected[0] || expected[0].bindings !== visible.rows[0]?.bindings ||
        expected[0].listings !== visible.rows[0]?.listings) throw new ProvisionRefusal("probe", "visibility");
    const locks = await client.query(PROVISION_SQL.smokeLock);
    const negativeRefused: boolean[] = [];
    for (const sql of [PROVISION_SQL.negativeEmail, PROVISION_SQL.negativeRole, PROVISION_SQL.negativeApproval]) {
      negativeRefused.push(await verifyPermissionDenied((statement) => client!.query(statement), sql));
    }
    await client.query("ROLLBACK");
    assertSmoke({ currentUser: current.rows[0]?.role, pendingJobs: queue.rows[0]?.pending_jobs,
      lockRowCount: locks.rowCount ?? -1, negativeRefused });
  } catch (error) {
    await client?.query("ROLLBACK").catch(() => undefined);
    if (error instanceof ProvisionRefusal) throw error;
    throw new ProvisionRefusal("probe", "connect");
  } finally {
    client?.release();
    await pool.end().catch(() => undefined);
  }
}

async function writeDesktopEnv(
  token: string,
  classification: EnvClassification,
  writes: ReturnType<typeof prepareDesktop>["writes"],
): Promise<void> {
  for (const item of writes) {
    const id = ownEnvId(classification, item.key);
    const url = id ? vercelEnvUpdateUrl(id) : vercelEnvCreateUrl();
    await discardWrite(token, url, id ? "PATCH" : "POST", vercelWriteBody(item, id ? "update" : "create"), item.key);
  }
  const verified = classifyProjectEnv(await vercelJson(token, vercelEnvListUrl(), "vercel"));
  for (const item of writes) {
    if (!ownEnvId(verified, item.key)) throw new ProvisionRefusal("vercel_write", item.key);
  }
  if (verified.conflicts.length > 0) throw new ProvisionRefusal("vercel", "inherited_key");
}

async function remoteFacts(pins: LocalPins): Promise<{ classification: EnvClassification; alias: AliasSnapshot }> {
  assertProjectMetadata(await vercelJson(pins.token, vercelProjectUrl(), "project"));
  const classification = classifyProjectEnv(await vercelJson(pins.token, vercelEnvListUrl(), "vercel"));
  assertRedisMetadata(classification);
  const alias = readAliasSnapshot(await vercelJson(pins.token, vercelAliasUrl(), "alias"));
  await imageKitMetadata(pins.privateKey);
  return { classification, alias };
}

async function disableActivated(pins: LocalPins, activated: boolean): Promise<boolean> {
  if (!activated) return false;
  try {
    await alterRole(pins, disableStatement(), "activation");
    return true;
  } catch {
    return false;
  }
}

function failure(error: unknown, flags: FailureFlags): ProvisionRefusal {
  if (error instanceof ProvisionRefusal) {
    return new ProvisionRefusal(error.phase, error.code, flags);
  }
  return new ProvisionRefusal("apply", "failed", flags);
}

async function apply(pins: LocalPins, classification: EnvClassification, alias: AliasSnapshot, loginEnabled: boolean): Promise<void> {
  const file = provisioningStatePath(repoRoot);
  const state = await loadState(file);
  const decision = decideProvision({ loginEnabled, state, classification });
  if (decision.action === "refuse") throw new ProvisionRefusal("state", decision.code);
  const password = decision.action === "reuse" ? decision.password : generateProvisioningPassword();
  const prepared = prepareDesktop({ ...pins, password });
  if (decision.action === "create") await saveState(file, password);
  else await restrictToCurrentUser(file).catch(() => { throw new ProvisionRefusal("state", "acl"); });
  let activated = false;
  let activationAttempted = false;
  const needsActivation = decision.action === "create" || (decision.action === "reuse" && !decision.alreadyEnabled);
  try {
    if (needsActivation) {
      activationAttempted = true;
      await alterRole(pins, activationStatement(password), "activation");
      activated = true;
    }
    await probeWorker(pins, prepared.workerDatabaseUrl);
    await writeDesktopEnv(pins.token, classification, prepared.writes);
    assertAliasUnchanged(alias, readAliasSnapshot(await vercelJson(pins.token, vercelAliasUrl(), "alias")));
  } catch (error) {
    const concurrent = error instanceof ProvisionRefusal && error.code === "concurrent_login";
    const loginDisabledAfterFailure = await disableActivated(pins, activationAttempted && !concurrent);
    throw failure(error, { loginActivatedThisRun: activated, loginDisabledAfterFailure, recoveryStateRetained: true });
  }
}

async function run(mode: "check" | "apply"): Promise<Record<string, unknown>> {
  const pins = collectLocalPins();
  const remote = await remoteFacts(pins);
  const database = await readDatabase(pins);
  prepareDesktop({ ...pins, password: generateProvisioningPassword() });
  if (mode === "apply") await apply(pins, remote.classification, remote.alias, database.loginEnabled);
  return {
    ok: true,
    mode,
    pendingJobs: database.pendingJobs,
    workerRestricted: true,
    loginEnabled: mode === "apply" ? true : database.loginEnabled,
    configurationWritten: mode === "apply",
    redeploymentRequired: mode === "apply",
    adminsReady: true,
    redisPresent: true,
    configAccepted: true,
    aliasReady: true,
    branch: pins.branch,
  };
}

function writeReceipt(receipt: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

async function main(): Promise<void> {
  let mode: "check" | "apply" | "help" = "check";
  try {
    mode = parseProvisionMode(process.argv.slice(2));
    if (mode === "help") {
      writeReceipt({ ok: true, mode: "help", usage: PROVISION_USAGE });
      return;
    }
    writeReceipt(await run(mode));
  } catch (error) {
    const refusal = error instanceof ProvisionRefusal ? error : new ProvisionRefusal("runtime", "failed");
    writeReceipt({
      ok: false,
      mode: mode === "help" ? "check" : mode,
      phase: refusal.phase,
      name: refusal.code,
      ...refusal.failure,
    });
    process.exitCode = 1;
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  void main();
}

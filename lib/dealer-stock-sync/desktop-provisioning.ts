import { randomBytes } from "node:crypto";
import path from "node:path";
import { readDatabaseCaCertificate } from "@/lib/db/pool-options";
import { parseSupabaseConnectionIdentity } from "@/lib/db/supabase-identity";
import { resolveDesktopGate } from "@/lib/dealer-stock-sync/desktop-config";

export const STAGING_SUPABASE_REF = "syneonzucehwlghqmfbg";
export const PRODUCTION_SUPABASE_REF = "snlqivvogfqesxpbjiei";
export const CANONICAL_ORIGIN = "https://itrader.dev";
export const STAGING_SUPABASE_URL = `https://${STAGING_SUPABASE_REF}.supabase.co`;
export const VERCEL_PROJECT_ID = "prj_TFAfJkG9P0osjQpsH2gaNrSPWbCr";
export const VERCEL_TEAM_ID = "team_nNF8inhmRhFvWkaLOl2cwdE6";
export const POOLER_HOST = "aws-0-eu-west-2.pooler.supabase.com";
export const WORKER_ROLE = "itrader_stock_worker";
export const CHILD_ROLES = ["itrader_stock_matt", "itrader_stock_dave"] as const;
export const ADMIN_IDS = ["cmn3oevp900065gzj1ue7y4gq", "cmn3of9ex000004lh8tsvfbjy"] as const;
export const PRODUCTION_ALIAS = "itrader.im";
export const IMAGEKIT_ENDPOINT = "https://ik.imagekit.io/itraderim";
export const DB_TIMEOUT_MS = 15_000;
export const MAX_DESKTOP_CONFIG_CHARS = 48_000;
export const PROVISION_STATE_VERSION = 1;
export const STATE_RELATIVE_PATH = "private/stock-update-desktop-build/provisioning/staging-shared.dpapi";
export const DEDICATED_PRIVATE_KEY_NAME = "DEALER_STOCK_DESKTOP_STAGING_IMAGEKIT_PRIVATE_KEY";
export const DEDICATED_PUBLIC_KEY_NAME = "DEALER_STOCK_DESKTOP_STAGING_IMAGEKIT_PUBLIC_KEY";

export const DESKTOP_ENV_KEYS = [
  "DEALER_STOCK_DESKTOP_ALLOWED_ADMIN_IDS",
  "DEALER_STOCK_DESKTOP_CONFIG_JSON",
  "DEALER_STOCK_DESKTOP_ENABLED",
] as const;

export type DesktopEnvKey = (typeof DESKTOP_ENV_KEYS)[number];

export const PROVISION_SQL = {
  admins: `SELECT id, role::text AS role, ("disabledAt" IS NOT NULL) AS disabled, ("deletedAt" IS NOT NULL) AS deleted
    FROM "User" WHERE id = ANY($1::text[])`,
  queue: `SELECT count(*)::int AS pending_jobs FROM "DealerStockSyncJob" WHERE status IN ('QUEUED', 'LEASED')`,
  workerFlags: `SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
    FROM pg_roles WHERE rolname = $1`,
  childFlags: `SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = ANY($1::text[])`,
  adminOption: `SELECT m.admin_option
    FROM pg_auth_members m
    JOIN pg_roles granted ON granted.oid = m.roleid
    JOIN pg_roles member ON member.oid = m.member
    WHERE granted.rolname = $1 AND member.rolname = current_user`,
  currentUser: "SELECT current_user AS role",
  smokeLock: `SELECT id FROM "DealerStockSourceBinding" WHERE "verifiedAt" IS NOT NULL ORDER BY id LIMIT 1 FOR UPDATE`,
  visibility: `SELECT (SELECT count(*)::int FROM "DealerStockSourceBinding" WHERE "verifiedAt" IS NOT NULL) AS bindings, (SELECT count(*)::int FROM "Listing" WHERE "dealerId" IN (SELECT "dealerId" FROM "DealerStockSourceBinding" WHERE "verifiedAt" IS NOT NULL)) AS listings`,
  negativeEmail: `SELECT email FROM "User" WHERE false`,
  negativeRole: `UPDATE "User" SET role = role WHERE false`,
  negativeApproval: `UPDATE "DealerStockSyncReport" SET "approvedById" = "approvedById" WHERE false`,
} as const;

export const PROVISION_USAGE = [
  "Usage: npx tsx scripts/stock-update-desktop/provision-staging.ts [--check|--apply]",
  "--check (default) validates staging pins and prints a non-secret receipt. It does not change the database or Vercel.",
  "--apply runs those checks, then activates the existing itrader_stock_worker login and writes three staging preview settings.",
].join("\n");

export interface FailureFlags {
  loginActivatedThisRun?: boolean;
  loginDisabledAfterFailure?: boolean;
  recoveryStateRetained?: boolean;
}

export class ProvisionRefusal extends Error {
  readonly phase: string;
  readonly code: string;
  readonly failure: FailureFlags;

  constructor(phase: string, code: string, failure: FailureFlags = {}) {
    super(`${phase}:${code}`);
    this.name = "ProvisionRefusal";
    this.phase = phase;
    this.code = code;
    this.failure = failure;
  }
}

export interface ProvisionState {
  version: 1;
  role: typeof WORKER_ROLE;
  projectRef: typeof STAGING_SUPABASE_REF;
  vercelProjectId: typeof VERCEL_PROJECT_ID;
  teamId: typeof VERCEL_TEAM_ID;
  gitBranch: "staging";
  environment: "preview";
  password: string;
}

export interface VercelEnvWrite {
  key: DesktopEnvKey;
  value: string;
  type: "sensitive";
  target: ["preview"];
  gitBranch: "staging";
}

export interface OwnEnvRecord {
  id: string;
  key: DesktopEnvKey;
}

export interface EnvClassification {
  own: OwnEnvRecord[];
  conflicts: string[];
  redisUrl: boolean;
  redisToken: boolean;
  desktopKeyPresent: boolean;
}

export interface AliasSnapshot {
  alias: string;
  deploymentId: string;
  projectId: string;
}

export interface PreparedDesktop {
  writes: VercelEnvWrite[];
  workerDatabaseUrl: string;
}

export type LoginDecision =
  | { action: "create" }
  | { action: "reuse"; password: string; alreadyEnabled: boolean }
  | { action: "refuse"; code: "unknown_login" | "missing_state" | "inherited_key" | "state_mismatch" };

const STATE_KEYS = ["environment", "gitBranch", "password", "projectRef", "role", "teamId", "vercelProjectId", "version"];

export function parseProvisionMode(argv: readonly string[]): "check" | "apply" | "help" {
  if (argv.length === 0) return "check";
  if (argv.length === 1 && argv[0] === "--check") return "check";
  if (argv.length === 1 && argv[0] === "--apply") return "apply";
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) return "help";
  throw new ProvisionRefusal("cli", "usage");
}

export function requireBoolean(value: unknown, phase: string, code: string): boolean {
  if (value === true || value === "t" || value === "true") return true;
  if (value === false || value === "f" || value === "false") return false;
  throw new ProvisionRefusal(phase, code);
}

export function assertPins(input: { branch: string; projectId: string; teamId: string }): void {
  if (input.branch !== "staging") throw new ProvisionRefusal("branch", "staging");
  if (input.projectId !== VERCEL_PROJECT_ID) throw new ProvisionRefusal("project", "id");
  if (input.teamId !== VERCEL_TEAM_ID) throw new ProvisionRefusal("project", "team");
}

export function privateTreeIgnored(gitignore: string): boolean {
  return gitignore.split(/\r?\n/).some((line) => line.trim() === "/private/");
}

export function provisioningStatePath(repoRoot: string): string {
  const root = path.resolve(repoRoot);
  const resolved = path.resolve(root, STATE_RELATIVE_PATH);
  const relative = path.relative(root, resolved).replaceAll("\\", "/");
  if (relative !== STATE_RELATIVE_PATH) throw new ProvisionRefusal("state", "path");
  return resolved;
}

export function assertVercelToken(token: string | undefined): string {
  if (!token || !token.trim() || /\s/.test(token)) throw new ProvisionRefusal("input", "VERCEL_BILLING_TOKEN");
  return token;
}

export function assertRedisEnv(url: string | undefined, token: string | undefined): void {
  if (!url?.trim() || !token?.trim()) throw new ProvisionRefusal("redis", "input");
}

export function readStagingCertificate(raw: string | undefined): string {
  if (!raw?.trim()) throw new ProvisionRefusal("input", "SUPABASE_DB_CA_CERT");
  try {
    const certificate = readDatabaseCaCertificate({ SUPABASE_DB_CA_CERT: raw });
    if (!certificate) throw new ProvisionRefusal("input", "SUPABASE_DB_CA_CERT");
    return certificate;
  } catch (error) {
    if (error instanceof ProvisionRefusal) throw error;
    throw new ProvisionRefusal("input", "SUPABASE_DB_CA_CERT");
  }
}

export function assertDedicatedImageKit(input: {
  privateKey: string | undefined;
  publicKey: string | undefined;
  applicationPrivateKey?: string;
  applicationPublicKey?: string;
}): { privateKey: string; publicKey: string } {
  const privateKey = input.privateKey ?? "";
  const publicKey = input.publicKey ?? "";
  if (!privateKey.startsWith("private_") || privateKey.length < 32 || /[\r\n\0]/.test(privateKey)) {
    throw new ProvisionRefusal("imagekit_keys", "private");
  }
  if (!publicKey.startsWith("public_") || publicKey.length < 8 || /[\r\n\0]/.test(publicKey)) {
    throw new ProvisionRefusal("imagekit_keys", "public");
  }
  if ((input.applicationPrivateKey && input.applicationPrivateKey === privateKey) ||
    (input.applicationPublicKey && input.applicationPublicKey === publicKey)) {
    throw new ProvisionRefusal("imagekit_keys", "application_fallback");
  }
  return { privateKey, publicKey };
}

export function assertConfiguredDatabaseProjects(urls: readonly string[]): void {
  if (urls.length < 1) throw new ProvisionRefusal("database", "missing");
  for (const raw of urls) {
    const identity = parseSupabaseConnectionIdentity(raw);
    if (identity?.projectRef === PRODUCTION_SUPABASE_REF) throw new ProvisionRefusal("database", "production_project");
    if (!identity || identity.projectRef !== STAGING_SUPABASE_REF) throw new ProvisionRefusal("database", "project");
  }
}

export function assertAdminDatabaseUrl(raw: string): { url: string; host: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ProvisionRefusal("database", "admin_url");
  }
  const identity = parseSupabaseConnectionIdentity(raw);
  if (!identity || identity.kind !== "pooler" || identity.projectRef !== STAGING_SUPABASE_REF || identity.role !== "postgres") {
    throw new ProvisionRefusal("database", "admin_identity");
  }
  if (parsed.hostname !== POOLER_HOST || parsed.port !== "5432" || parsed.pathname !== "/postgres" || !parsed.password || parsed.hash) throw new ProvisionRefusal("database", "admin_host");
  return { url: raw, host: parsed.hostname };
}

export function assertProvisioningPassword(password: string): void {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(password)) throw new ProvisionRefusal("state", "password");
}

export function generateProvisioningPassword(): string {
  return randomBytes(32).toString("base64url");
}

export function escapeLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

export function activationStatement(password: string): string {
  assertProvisioningPassword(password);
  return `ALTER ROLE ${WORKER_ROLE} WITH LOGIN PASSWORD '${escapeLiteral(password)}'`;
}

export function disableStatement(): string {
  return `ALTER ROLE ${WORKER_ROLE} WITH NOLOGIN`;
}

export function buildWorkerDatabaseUrl(host: string, password: string): string {
  assertProvisioningPassword(password);
  if (host !== POOLER_HOST) throw new ProvisionRefusal("database", "worker_host");
  const url = new URL("postgresql://localhost/postgres");
  url.hostname = host;
  url.port = "5432";
  url.username = `${WORKER_ROLE}.${STAGING_SUPABASE_REF}`;
  url.password = password;
  url.pathname = "/postgres";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function buildSharedWorkerEnv(input: {
  password: string;
  certificate: string;
  privateKey: string;
  publicKey: string;
  host: string;
}): Record<string, string> {
  return {
    DEALER_STOCK_SYNC_TARGET: "preview",
    VERCEL_ENV: "preview",
    ITRADER_DEPLOYMENT_ROLE: "staging",
    NODE_ENV: "production",
    DEALER_STOCK_SYNC_WORKER: "1",
    NEXT_PUBLIC_APP_URL: CANONICAL_ORIGIN,
    NEXT_PUBLIC_SUPABASE_URL: STAGING_SUPABASE_URL,
    DATABASE_URL: buildWorkerDatabaseUrl(input.host, input.password),
    SUPABASE_DB_CA_CERT: input.certificate,
    MEDIA_PROVIDER: "imagekit",
    NEXT_PUBLIC_MEDIA_PROVIDER: "imagekit",
    MEDIA_UPLOAD_PROVIDER: "imagekit",
    IMAGEKIT_UPLOADS_ENABLED: "1",
    IMAGEKIT_URL_ENDPOINT: IMAGEKIT_ENDPOINT,
    IMAGEKIT_PUBLIC_KEY: input.publicKey,
    IMAGEKIT_PRIVATE_KEY: input.privateKey,
  };
}

export function buildDesktopConfig(shared: Record<string, string>): Record<string, Record<string, string>> {
  return {
    [ADMIN_IDS[0]]: { ...shared },
    [ADMIN_IDS[1]]: { ...shared },
  };
}

export function buildGateEnv(adminDatabaseUrl: string, config: Record<string, Record<string, string>>): Record<string, string> {
  const json = JSON.stringify(config);
  if (json.length > MAX_DESKTOP_CONFIG_CHARS) throw new ProvisionRefusal("config", "size");
  return {
    DEALER_STOCK_DESKTOP_ENABLED: "1",
    DEALER_STOCK_DESKTOP_ALLOWED_ADMIN_IDS: ADMIN_IDS.join(","),
    DEALER_STOCK_DESKTOP_CONFIG_JSON: json,
    VERCEL_ENV: "preview",
    DEALER_STOCK_SYNC_TARGET: "preview",
    ITRADER_DEPLOYMENT_ROLE: "staging",
    NODE_ENV: "production",
    NEXT_PUBLIC_APP_URL: CANONICAL_ORIGIN,
    NEXT_PUBLIC_SUPABASE_URL: STAGING_SUPABASE_URL,
    DATABASE_URL: adminDatabaseUrl,
  };
}

export function assertProposedConfig(adminDatabaseUrl: string, config: Record<string, Record<string, string>>): void {
  const ids = Object.keys(config);
  if (ids.length !== 2 || ids[0] !== ADMIN_IDS[0] || ids[1] !== ADMIN_IDS[1]) {
    throw new ProvisionRefusal("config", "admins");
  }
  const [first, second] = Object.values(config);
  if (!first || !second || JSON.stringify(first) !== JSON.stringify(second)) throw new ProvisionRefusal("config", "shared");
  const gate = resolveDesktopGate(buildGateEnv(adminDatabaseUrl, config));
  if (!gate.ok) throw new ProvisionRefusal("config", gate.reason);
}

export function buildEnvWrites(config: Record<string, Record<string, string>>): VercelEnvWrite[] {
  const json = JSON.stringify(config);
  if (json.length > MAX_DESKTOP_CONFIG_CHARS) throw new ProvisionRefusal("config", "size");
  return [
    write("DEALER_STOCK_DESKTOP_ALLOWED_ADMIN_IDS", ADMIN_IDS.join(",")),
    write("DEALER_STOCK_DESKTOP_CONFIG_JSON", json),
    write("DEALER_STOCK_DESKTOP_ENABLED", "1"),
  ];
}

function write(key: DesktopEnvKey, value: string): VercelEnvWrite {
  return { key, value, type: "sensitive", target: ["preview"], gitBranch: "staging" };
}

export function assertEnvWrites(writes: readonly VercelEnvWrite[]): void {
  if (writes.length !== DESKTOP_ENV_KEYS.length || writes[writes.length - 1]?.key !== "DEALER_STOCK_DESKTOP_ENABLED") {
    throw new ProvisionRefusal("vercel_write", "order");
  }
  writes.forEach((item, index) => {
    if (item.key !== DESKTOP_ENV_KEYS[index] || item.type !== "sensitive" || item.gitBranch !== "staging") {
      throw new ProvisionRefusal("vercel_write", "scope");
    }
    if (item.target.length !== 1 || item.target[0] !== "preview") throw new ProvisionRefusal("vercel_write", "target");
  });
}

export function prepareDesktop(input: {
  password: string;
  certificate: string;
  privateKey: string;
  publicKey: string;
  host: string;
  adminDatabaseUrl: string;
}): PreparedDesktop {
  const shared = buildSharedWorkerEnv(input);
  const config = buildDesktopConfig(shared);
  assertProposedConfig(input.adminDatabaseUrl, config);
  const writes = buildEnvWrites(config);
  assertEnvWrites(writes);
  const workerDatabaseUrl = shared.DATABASE_URL;
  if (!workerDatabaseUrl) throw new ProvisionRefusal("config", "database");
  return { writes, workerDatabaseUrl };
}

export function vercelWriteBody(item: VercelEnvWrite, mode: "create" | "update"): Record<string, unknown> {
  const shared = { value: item.value, type: item.type, target: item.target, gitBranch: item.gitBranch };
  return mode === "create" ? { key: item.key, ...shared } : shared;
}

export function vercelProjectUrl(): string {
  return `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}?teamId=${VERCEL_TEAM_ID}`;
}

export function vercelEnvListUrl(): string {
  return `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/env?teamId=${VERCEL_TEAM_ID}&decrypt=false`;
}

export function vercelEnvCreateUrl(): string {
  return `https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/env?teamId=${VERCEL_TEAM_ID}`;
}

export function vercelEnvUpdateUrl(envId: string): string {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(envId)) throw new ProvisionRefusal("vercel", "env_id");
  return `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/env/${envId}?teamId=${VERCEL_TEAM_ID}`;
}

export function vercelAliasUrl(): string {
  return `https://api.vercel.com/v4/aliases/${PRODUCTION_ALIAS}?teamId=${VERCEL_TEAM_ID}`;
}

export function assertProjectMetadata(body: unknown): void {
  if (!body || typeof body !== "object") throw new ProvisionRefusal("project", "metadata");
  const record = body as Record<string, unknown>;
  const account = record.accountId ?? record.orgId;
  if (record.id !== VERCEL_PROJECT_ID || account !== VERCEL_TEAM_ID) throw new ProvisionRefusal("project", "metadata");
}

function targetList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") return [value];
  return [];
}

function isDesktopKey(value: string): value is DesktopEnvKey {
  return (DESKTOP_ENV_KEYS as readonly string[]).includes(value);
}

export function classifyProjectEnv(body: unknown): EnvClassification {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { envs?: unknown }).envs)
      ? (body as { envs: unknown[] }).envs
      : null;
  if (!list) throw new ProvisionRefusal("vercel", "metadata");
  const classification: EnvClassification = {
    own: [], conflicts: [], redisUrl: false, redisToken: false, desktopKeyPresent: false,
  };
  for (const entry of list) {
    if (!entry || typeof entry !== "object") throw new ProvisionRefusal("vercel", "metadata");
    const record = entry as Record<string, unknown>;
    const key = typeof record.key === "string" ? record.key : "";
    const targets = targetList(record.target);
    const appliesToStaging = targets.includes("preview") && (!record.gitBranch || record.gitBranch === "staging");
    if (!appliesToStaging) continue;
    if (key === "UPSTASH_REDIS_REST_URL") classification.redisUrl = true;
    if (key === "UPSTASH_REDIS_REST_TOKEN") classification.redisToken = true;
    if (!isDesktopKey(key)) continue;
    classification.desktopKeyPresent = true;
    const own = record.type === "sensitive" && record.gitBranch === "staging" &&
      targets.length === 1 && targets[0] === "preview" && typeof record.id === "string";
    if (own) classification.own.push({ id: record.id as string, key });
    else classification.conflicts.push(key);
  }
  return classification;
}

export function assertRedisMetadata(classification: EnvClassification): void {
  if (!classification.redisUrl || !classification.redisToken) throw new ProvisionRefusal("redis", "missing");
}

export function ownEnvId(classification: EnvClassification, key: DesktopEnvKey): string | null {
  return classification.own.find((record) => record.key === key)?.id ?? null;
}

export function readAliasSnapshot(body: unknown): AliasSnapshot {
  if (!body || typeof body !== "object") throw new ProvisionRefusal("alias", "metadata");
  const record = body as Record<string, unknown>;
  const nested = record.deployment;
  const deploymentId = typeof record.deploymentId === "string"
    ? record.deploymentId
    : nested && typeof nested === "object" && typeof (nested as { id?: unknown }).id === "string"
      ? (nested as { id: string }).id
      : "";
  const projectId = typeof record.projectId === "string" ? record.projectId : "";
  if (record.alias !== PRODUCTION_ALIAS || !deploymentId || !projectId) throw new ProvisionRefusal("alias", "snapshot");
  return { alias: PRODUCTION_ALIAS, deploymentId, projectId };
}

export function assertAliasUnchanged(before: AliasSnapshot, after: AliasSnapshot): void {
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new ProvisionRefusal("alias", "changed");
}

export function assertAdmins(rows: readonly Record<string, unknown>[]): void {
  if (rows.length !== ADMIN_IDS.length) throw new ProvisionRefusal("admins", "ids");
  const ids = new Set(rows.map((row) => row.id));
  if (ADMIN_IDS.some((id) => !ids.has(id))) throw new ProvisionRefusal("admins", "ids");
  for (const row of rows) {
    if (row.role !== "ADMIN") throw new ProvisionRefusal("admins", "role");
    if (requireBoolean(row.disabled, "admins", "flags") || requireBoolean(row.deleted, "admins", "flags")) {
      throw new ProvisionRefusal("admins", "flags");
    }
  }
}

export function assertQueueEmpty(count: unknown): number {
  const pending = typeof count === "number" ? count : typeof count === "string" ? Number(count) : Number.NaN;
  if (pending !== 0) throw new ProvisionRefusal("queue", "pending_jobs");
  return pending;
}

export function assertRestrictedWorker(row: Record<string, unknown>): boolean {
  const login = requireBoolean(row.rolcanlogin, "worker_role", "flags");
  const elevated = ["rolsuper", "rolbypassrls", "rolcreaterole", "rolcreatedb"].some((key) =>
    requireBoolean(row[key], "worker_role", "restrictions"));
  if (elevated) throw new ProvisionRefusal("worker_role", "restrictions");
  return login;
}

export function assertChildRoles(rows: readonly Record<string, unknown>[]): void {
  const found = new Map<string, boolean>();
  for (const row of rows) {
    if (typeof row.rolname !== "string") throw new ProvisionRefusal("worker_role", "child_missing");
    found.set(row.rolname, requireBoolean(row.rolcanlogin, "worker_role", "child_flags"));
  }
  for (const role of CHILD_ROLES) {
    if (!found.has(role)) throw new ProvisionRefusal("worker_role", "child_missing");
    if (found.get(role) !== false) throw new ProvisionRefusal("worker_role", "child_login");
  }
}

export function assertAdminOption(rows: readonly Record<string, unknown>[]): void {
  const allowed = rows.some((row) => requireBoolean(row.admin_option, "worker_role", "admin_option"));
  if (!allowed) throw new ProvisionRefusal("worker_role", "admin_option");
}

export function assertSmoke(input: {
  currentUser: unknown;
  pendingJobs: unknown;
  lockRowCount: number;
  negativeRefused: readonly boolean[];
}): void {
  if (input.currentUser !== WORKER_ROLE) throw new ProvisionRefusal("probe", "role");
  assertQueueEmpty(input.pendingJobs);
  if (input.lockRowCount !== 1) throw new ProvisionRefusal("probe", "locks");
  if (input.negativeRefused.length !== 3 || input.negativeRefused.some((refused) => !refused)) {
    throw new ProvisionRefusal("probe", "privileges");
  }
}

export function buildProvisionState(password: string): ProvisionState {
  assertProvisioningPassword(password);
  return {
    version: PROVISION_STATE_VERSION,
    role: WORKER_ROLE,
    projectRef: STAGING_SUPABASE_REF,
    vercelProjectId: VERCEL_PROJECT_ID,
    teamId: VERCEL_TEAM_ID,
    gitBranch: "staging",
    environment: "preview",
    password,
  };
}

export function parseProvisionState(raw: string): ProvisionState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProvisionRefusal("state", "malformed");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ProvisionRefusal("state", "malformed");
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).sort().join() !== [...STATE_KEYS].sort().join()) throw new ProvisionRefusal("state", "shape");
  if (record.version !== PROVISION_STATE_VERSION || record.role !== WORKER_ROLE ||
    record.projectRef !== STAGING_SUPABASE_REF || record.vercelProjectId !== VERCEL_PROJECT_ID ||
    record.teamId !== VERCEL_TEAM_ID || record.gitBranch !== "staging" || record.environment !== "preview" ||
    typeof record.password !== "string") {
    throw new ProvisionRefusal("state", "mismatch");
  }
  assertProvisioningPassword(record.password);
  return buildProvisionState(record.password);
}

export function decideProvision(input: {
  loginEnabled: boolean;
  state: ProvisionState | null;
  classification: EnvClassification;
}): LoginDecision {
  if (input.classification.conflicts.length > 0) return { action: "refuse", code: "inherited_key" };
  if (input.classification.desktopKeyPresent && !input.state) return { action: "refuse", code: "missing_state" };
  if (input.loginEnabled && !input.state) return { action: "refuse", code: "unknown_login" };
  if (input.state) return { action: "reuse", password: input.state.password, alreadyEnabled: input.loginEnabled };
  return { action: "create" };
}

/** A rejected SQL statement aborts its transaction: isolate every negative probe. */
export async function verifyPermissionDenied(
  query: (sql: string) => Promise<unknown>, statement: string,
): Promise<boolean> {
  await query("SAVEPOINT stock_permission_probe");
  let denied = false;
  try { await query(statement); }
  catch (error) {
    denied = Boolean(error && typeof error === "object" && "code" in error && error.code === "42501");
  } finally {
    await query("ROLLBACK TO SAVEPOINT stock_permission_probe");
    await query("RELEASE SAVEPOINT stock_permission_probe");
  }
  return denied;
}

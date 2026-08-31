import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { assertNoSafetyKeysInEnvFile } from "./safety";

const CONNECTION_KEYS = new Set([
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_HOST",
  "POSTGRES_PASSWORD",
  "POSTGRES_USER",
  "POSTGRES_DATABASE",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
]);

export interface ConnectionEnv {
  databaseUrl?: string;
  postgresUrlNonPooling?: string;
  supabaseUrl?: string;
  serviceRoleKey?: string;
  postgresHost?: string;
  postgresPassword?: string;
  postgresUser?: string;
  postgresDatabase?: string;
}

export function buildDirectDatabaseUrl(input: {
  host?: string;
  user?: string;
  password?: string;
  database?: string;
}): string | undefined {
  if (!input.host?.trim() || !input.password) return undefined;
  const user = encodeURIComponent(input.user?.trim() || "postgres");
  const password = encodeURIComponent(input.password);
  const database = encodeURIComponent(input.database?.trim() || "postgres");
  return `postgresql://${user}:${password}@${input.host.trim()}:5432/${database}`;
}

function parseEnvFile(filePath: string) {
  if (!existsSync(filePath)) {
    throw new Error(`Refusing mirror: env file not found (${filePath}).`);
  }
  const values: Record<string, string> = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^"(.*)"$/, "$1");
    if (key) values[key] = val;
  }
  return values;
}

export function loadConnectionEnv(filePath: string, cwd = process.cwd()): ConnectionEnv {
  const resolved = resolve(cwd, filePath);
  const parsed = parseEnvFile(resolved);
  assertNoSafetyKeysInEnvFile(parsed);
  const picked: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (CONNECTION_KEYS.has(key)) picked[key] = value;
  }
  return {
    databaseUrl: picked.DATABASE_URL,
    postgresUrlNonPooling: picked.POSTGRES_URL_NON_POOLING ?? picked.POSTGRES_URL,
    supabaseUrl: picked.NEXT_PUBLIC_SUPABASE_URL ?? picked.SUPABASE_URL,
    serviceRoleKey: picked.SUPABASE_SERVICE_ROLE_KEY ?? picked.SUPABASE_SECRET_KEY,
    postgresHost: picked.POSTGRES_HOST,
    postgresPassword: picked.POSTGRES_PASSWORD,
    postgresUser: picked.POSTGRES_USER,
    postgresDatabase: picked.POSTGRES_DATABASE,
  };
}

export function connectionCandidates(env: ConnectionEnv) {
  return [
    buildDirectDatabaseUrl({
      host: env.postgresHost,
      user: env.postgresUser,
      password: env.postgresPassword,
      database: env.postgresDatabase,
    }),
    env.postgresUrlNonPooling,
    env.databaseUrl,
  ];
}

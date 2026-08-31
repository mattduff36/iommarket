import { existsSync } from "node:fs";
import { AUTH_RESTORE_SKIP_TABLES } from "./constants";

export function withRequiredSsl(connectionString: string) {
  const parsed = new URL(connectionString);
  parsed.searchParams.set("sslmode", "require");
  return parsed.toString();
}

export function pgDumpDataArgs(databaseUrl: string, outFile: string) {
  const args = [
    "--data-only",
    "--no-owner",
    "--no-acl",
    "--schema=public",
    "--schema=auth",
    `--file=${outFile}`,
    databaseUrl,
  ];
  for (const table of AUTH_RESTORE_SKIP_TABLES) {
    args.splice(-1, 0, `--exclude-table=auth.${table}`);
  }
  return args;
}

export function restoreSessionSql() {
  return [
    "SET session_replication_role = replica;",
    "SET lock_timeout = '0';",
    "SET statement_timeout = '0';",
  ].join("\n");
}

export function restoreSessionEndSql() {
  return "SET session_replication_role = origin;";
}

export function truncatePublicAndAuthSql(publicTables: string[]) {
  const quoted = publicTables
    .filter((name) => name !== "spatial_ref_sys")
    .map((name) => `"${name.replaceAll('"', "")}"`);
  const statements = [
    'TRUNCATE TABLE auth.identities, auth.users CASCADE;',
    quoted.length > 0 ? `TRUNCATE TABLE ${quoted.join(", ")} CASCADE;` : "",
  ].filter(Boolean);
  return statements.join("\n");
}

const WINDOWS_PG_BIN = "C:/Program Files/PostgreSQL/18/bin";

export function resolvePgBin(bin: "pg_dump" | "psql") {
  const extra = process.env.PROD_MIRROR_PG_BIN?.replace(/[\\/]$/, "");
  const candidates = [
    extra ? `${extra}/${bin}.exe` : "",
    extra ? `${extra}/${bin}` : "",
    `${WINDOWS_PG_BIN}/${bin}.exe`,
    `${WINDOWS_PG_BIN}/${bin}`,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return bin;
}

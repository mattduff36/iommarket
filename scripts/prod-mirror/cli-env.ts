import { loadConnectionEnv, type ConnectionEnv, connectionCandidates } from "./env";
import { parseArgValue } from "./safety";

function overlayEnv(base: ConnectionEnv, argv: string[], prefix: "preview" | "production"): ConnectionEnv {
  const databaseUrl = parseArgValue(argv, `${prefix}-database-url`);
  const supabaseUrl = parseArgValue(argv, `${prefix}-supabase-url`);
  const serviceRoleKey = parseArgValue(argv, `${prefix}-service-role`);
  return {
    databaseUrl: databaseUrl ?? base.databaseUrl,
    postgresUrlNonPooling: databaseUrl ?? base.postgresUrlNonPooling,
    supabaseUrl: supabaseUrl ?? base.supabaseUrl,
    serviceRoleKey: serviceRoleKey ?? base.serviceRoleKey,
    postgresHost: base.postgresHost,
    postgresPassword: base.postgresPassword,
    postgresUser: base.postgresUser,
    postgresDatabase: base.postgresDatabase,
  };
}

export function loadMirrorEnvs(argv: string[], cwd = process.cwd()): {
  preview: ConnectionEnv;
  production: ConnectionEnv;
} {
  const previewEnv = parseArgValue(argv, "preview-env") ?? ".env.local";
  const productionEnv = parseArgValue(argv, "production-env") ?? ".env.production";
  return {
    preview: overlayEnv(loadConnectionEnv(previewEnv, cwd), argv, "preview"),
    production: overlayEnv(loadConnectionEnv(productionEnv, cwd), argv, "production"),
  };
}

export function previewCandidates(env: ConnectionEnv) {
  return connectionCandidates(env);
}

export function productionCandidates(env: ConnectionEnv) {
  return connectionCandidates(env);
}

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  containsPreviewRef,
  EXPECTED_PRODUCTION_CLOUDINARY_CLOUD_NAME,
  PRODUCTION_DB_HOST,
  PRODUCTION_ENV_FILE,
  PRODUCTION_POOLER_USER,
  PRODUCTION_SUPABASE_HOST,
} from "./safety";

const CONNECTION_KEYS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
] as const;

export interface FoundingProductionEnv {
  databaseUrl: string;
  postgresUrlNonPooling: string | null;
  supabaseUrl: string;
  serviceRoleKey: string;
  cloudinaryCloudName: string;
  cloudinaryApiKey: string;
  cloudinaryApiSecret: string;
}

function parseEnvFile(filePath: string) {
  if (!existsSync(filePath)) {
    throw new Error(`Refusing founding onboard: env file not found (${filePath}).`);
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

function parseUrl(raw: string | undefined): URL | null {
  if (!raw?.trim()) return null;
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

function isDirectProductionDb(url: string) {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  if (parsed.hostname.toLowerCase() !== PRODUCTION_DB_HOST) return false;
  if (containsPreviewRef(url) || containsPreviewRef(parsed.username)) return false;
  return true;
}

function isProductionPoolerUrl(url: string) {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  if (containsPreviewRef(url) || containsPreviewRef(parsed.username)) return false;
  const host = parsed.hostname.toLowerCase();
  const user = decodeURIComponent(parsed.username || "").toLowerCase();
  return host.endsWith(".pooler.supabase.com") && user === PRODUCTION_POOLER_USER.toLowerCase();
}

export function resolveProductionDirectDatabaseUrl(raw: string) {
  if (isDirectProductionDb(raw)) return raw.trim();
  if (!isProductionPoolerUrl(raw)) {
    throw new Error(
      `Refusing founding onboard: database URL must use ${PRODUCTION_DB_HOST} or the production pooler user.`,
    );
  }
  const parsed = parseUrl(raw);
  if (!parsed?.password) {
    throw new Error("Refusing founding onboard: production database password is missing.");
  }
  const direct = new URL(parsed.toString());
  direct.protocol = "postgresql:";
  direct.hostname = PRODUCTION_DB_HOST;
  direct.port = "5432";
  direct.username = "postgres";
  direct.search = "";
  return direct.toString();
}

function isProductionSupabaseUrl(url: string) {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  if (parsed.protocol !== "https:") return false;
  if (parsed.hostname.toLowerCase() !== PRODUCTION_SUPABASE_HOST) return false;
  if (parsed.port && parsed.port !== "443") return false;
  if (containsPreviewRef(url)) return false;
  return true;
}

function readCloudinary(parsed: Record<string, string>) {
  return {
    cloudinaryCloudName: parsed.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME?.trim() ?? "",
    cloudinaryApiKey: parsed.CLOUDINARY_API_KEY?.trim() ?? "",
    cloudinaryApiSecret: parsed.CLOUDINARY_API_SECRET?.trim() ?? "",
  };
}

function assertProductionCloudinary(input: {
  cloudinaryCloudName: string;
  cloudinaryApiKey: string;
  cloudinaryApiSecret: string;
}) {
  if (input.cloudinaryCloudName !== EXPECTED_PRODUCTION_CLOUDINARY_CLOUD_NAME) {
    throw new Error(
      `Refusing founding onboard: Cloudinary cloud name must be ${EXPECTED_PRODUCTION_CLOUDINARY_CLOUD_NAME}.`,
    );
  }
  if (!input.cloudinaryApiKey || !input.cloudinaryApiSecret) {
    throw new Error("Refusing founding onboard: production Cloudinary API credentials are missing.");
  }
  return input;
}

function loadSharedCloudinary(cwd: string, fromProduction: ReturnType<typeof readCloudinary>) {
  if (fromProduction.cloudinaryCloudName && fromProduction.cloudinaryApiKey && fromProduction.cloudinaryApiSecret) {
    return assertProductionCloudinary(fromProduction);
  }
  const localPath = resolve(cwd, ".env.local");
  if (!existsSync(localPath)) {
    throw new Error("Refusing founding onboard: production Cloudinary credentials are missing.");
  }
  const local = readCloudinary(parseEnvFile(localPath));
  return assertProductionCloudinary(local);
}

export function loadFoundingProductionEnv(
  filePath = PRODUCTION_ENV_FILE,
  cwd = process.cwd(),
): FoundingProductionEnv {
  if (filePath !== PRODUCTION_ENV_FILE) {
    throw new Error(`Refusing founding onboard: env file must be ${PRODUCTION_ENV_FILE}.`);
  }
  const parsed = parseEnvFile(resolve(cwd, filePath));
  for (const [key, value] of Object.entries(parsed)) {
    if (containsPreviewRef(key) || containsPreviewRef(value)) {
      throw new Error("Refusing founding onboard: preview project ref found in production env file.");
    }
  }

  const supabaseUrl = parsed.NEXT_PUBLIC_SUPABASE_URL ?? parsed.SUPABASE_URL ?? "";
  const serviceRoleKey = parsed.SUPABASE_SERVICE_ROLE_KEY ?? parsed.SUPABASE_SECRET_KEY ?? "";
  const rawDatabaseUrl = parsed.POSTGRES_URL_NON_POOLING ?? parsed.DATABASE_URL ?? parsed.POSTGRES_URL ?? "";

  if (!isProductionSupabaseUrl(supabaseUrl)) {
    throw new Error(
      `Refusing founding onboard: NEXT_PUBLIC_SUPABASE_URL must be https://${PRODUCTION_SUPABASE_HOST}`,
    );
  }
  if (!serviceRoleKey) {
    throw new Error("Refusing founding onboard: missing production service role key.");
  }
  const databaseUrl = resolveProductionDirectDatabaseUrl(rawDatabaseUrl);
  const cloudinary = loadSharedCloudinary(cwd, readCloudinary(parsed));

  for (const key of CONNECTION_KEYS) {
    const value = parsed[key];
    if (value && containsPreviewRef(value)) {
      throw new Error(`Refusing founding onboard: ${key} points at preview.`);
    }
  }

  return {
    databaseUrl,
    postgresUrlNonPooling: isDirectProductionDb(parsed.POSTGRES_URL_NON_POOLING ?? "")
      ? parsed.POSTGRES_URL_NON_POOLING!.trim()
      : null,
    supabaseUrl: supabaseUrl.trim(),
    serviceRoleKey,
    cloudinaryCloudName: cloudinary.cloudinaryCloudName,
    cloudinaryApiKey: cloudinary.cloudinaryApiKey,
    cloudinaryApiSecret: cloudinary.cloudinaryApiSecret,
  };
}

export function chooseFoundingConnectionString(env: FoundingProductionEnv) {
  if (env.postgresUrlNonPooling && isDirectProductionDb(env.postgresUrlNonPooling)) {
    return env.postgresUrlNonPooling;
  }
  if (isDirectProductionDb(env.databaseUrl)) return env.databaseUrl;
  throw new Error("Refusing founding onboard: no allowed production connection string.");
}

export function assertNoAmbientPreviewOverride(env: NodeJS.ProcessEnv) {
  const suspects = [
    env.DATABASE_URL,
    env.POSTGRES_URL,
    env.POSTGRES_URL_NON_POOLING,
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_URL,
  ];
  for (const value of suspects) {
    if (containsPreviewRef(value)) {
      throw new Error("Refusing founding onboard: ambient process env points at preview.");
    }
  }
}

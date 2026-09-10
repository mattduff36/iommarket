import { parseArgValue } from "../prod-mirror/safety";
import { PREVIEW_PROJECT_REF, PRODUCTION_PROJECT_REF } from "../wipe-preview-marketplace/target";
import {
  AFFECTED_PREVIEW_PACK_KEYS,
  isAffectedPreviewPackKey,
  type AffectedPreviewPackKey,
} from "../../lib/preview-packs/repair-images";

export { PREVIEW_PROJECT_REF, PRODUCTION_PROJECT_REF, AFFECTED_PREVIEW_PACK_KEYS };
export const PREVIEW_CONFIRM_DB = `db.${PREVIEW_PROJECT_REF}.supabase.co/postgres`;
export const PREVIEW_ENV_FILE = ".env.local";
export const PREVIEW_APPLY_CONFIRM_TOKEN = `yes repair preview pack images ${PREVIEW_PROJECT_REF}`;
export const PREVIEW_DB_HOST = `db.${PREVIEW_PROJECT_REF}.supabase.co`;
export const PREVIEW_SUPABASE_HOST = `${PREVIEW_PROJECT_REF}.supabase.co`;
export const PREVIEW_POOLER_USER = `postgres.${PREVIEW_PROJECT_REF}`;

export interface PreviewPackRepairArgs {
  allow: boolean;
  destRef: string | null;
  confirmDb: string | null;
  apply: boolean;
  dryRun: boolean;
  envFile: string;
  dealer: string | null;
  allAffected: boolean;
  confirm: string | null;
  snapshot: string | null;
  planFingerprint: string | null;
  planCount: string | null;
}

export function parsePreviewPackRepairArgs(argv: string[]): PreviewPackRepairArgs {
  const apply = argv.includes("--apply");
  return {
    allow: parseArgValue(argv, "allow") === "1",
    destRef: parseArgValue(argv, "dest-ref") ?? null,
    confirmDb: parseArgValue(argv, "confirm-db") ?? null,
    apply,
    dryRun: !apply,
    envFile: parseArgValue(argv, "env-file") ?? PREVIEW_ENV_FILE,
    dealer: parseArgValue(argv, "dealer") ?? null,
    allAffected: argv.includes("--all-affected"),
    confirm: parseArgValue(argv, "confirm") ?? null,
    snapshot: parseArgValue(argv, "snapshot") ?? null,
    planFingerprint: parseArgValue(argv, "plan-fingerprint") ?? null,
    planCount: parseArgValue(argv, "plan-count") ?? null,
  };
}

export function assertPreviewPackRepairSafety(input: { argv: string[] }) {
  const args = parsePreviewPackRepairArgs(input.argv);
  if (!args.allow) {
    throw new Error("Refusing preview pack image repair: --allow=1 is required.");
  }
  if (args.destRef !== PREVIEW_PROJECT_REF) {
    throw new Error(`Refusing preview pack image repair: --dest-ref must be ${PREVIEW_PROJECT_REF}.`);
  }
  if (args.confirmDb !== PREVIEW_CONFIRM_DB) {
    throw new Error("Refusing preview pack image repair: --confirm-db must match the preview database host.");
  }
  if (args.envFile !== PREVIEW_ENV_FILE) {
    throw new Error(`Refusing preview pack image repair: env file must be ${PREVIEW_ENV_FILE}.`);
  }
  if (!args.dealer && !args.allAffected) {
    throw new Error("Refusing preview pack image repair: --dealer=<key> or --all-affected is required.");
  }
  if (args.dealer && !isAffectedPreviewPackKey(args.dealer)) {
    throw new Error(`Refusing preview pack image repair: ${args.dealer} is not in the affected pack list.`);
  }
  if (args.apply) {
    if (args.confirm !== PREVIEW_APPLY_CONFIRM_TOKEN) {
      throw new Error(`Refusing preview pack image repair: --confirm must be "${PREVIEW_APPLY_CONFIRM_TOKEN}".`);
    }
    if (!args.snapshot || !args.planFingerprint || !args.planCount) {
      throw new Error(
        "Refusing preview pack image repair: --apply requires --snapshot, --plan-fingerprint, and --plan-count.",
      );
    }
  }
  return args;
}

export function selectedPreviewRepairDealers(args: PreviewPackRepairArgs): AffectedPreviewPackKey[] {
  if (args.allAffected) return [...AFFECTED_PREVIEW_PACK_KEYS];
  if (args.dealer && isAffectedPreviewPackKey(args.dealer)) return [args.dealer];
  return [];
}

export function assertExactPreviewRepairEnvironment(input: {
  databaseUrl: string;
  supabaseUrl: string;
}) {
  let database: URL;
  let supabase: URL;
  try {
    database = new URL(input.databaseUrl);
    supabase = new URL(input.supabaseUrl);
  } catch {
    throw new Error("Refusing preview pack image repair: environment URLs are invalid.");
  }
  const databaseHost = database.hostname.toLowerCase();
  const databaseUser = decodeURIComponent(database.username || "").toLowerCase();
  const direct =
    databaseHost === PREVIEW_DB_HOST &&
    databaseUser === "postgres";
  const pooler =
    databaseHost.endsWith(".pooler.supabase.com") &&
    databaseUser === PREVIEW_POOLER_USER;
  if (
    (!direct && !pooler) ||
    supabase.protocol !== "https:" ||
    supabase.hostname.toLowerCase() !== PREVIEW_SUPABASE_HOST
  ) {
    throw new Error("Refusing preview pack image repair: environment is not the exact preview project.");
  }
  return input.databaseUrl;
}

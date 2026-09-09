import { parseArgValue } from "../prod-mirror/safety";
import {
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
} from "../wipe-preview-marketplace/target";
import { foundingDealerKeys } from "./allowlist";

export { PREVIEW_PROJECT_REF, PRODUCTION_PROJECT_REF };
export const PRODUCTION_POOLER_USER = `postgres.${PRODUCTION_PROJECT_REF}`;

export const PRODUCTION_CONFIRM_DB = `db.${PRODUCTION_PROJECT_REF}.supabase.co/postgres`;
export const PRODUCTION_SUPABASE_HOST = `${PRODUCTION_PROJECT_REF}.supabase.co`;
export const PRODUCTION_DB_HOST = `db.${PRODUCTION_PROJECT_REF}.supabase.co`;
export const APPLY_CONFIRM_TOKEN = `yes onboard founding dealers ${PRODUCTION_PROJECT_REF}`;
export const PRODUCTION_ENV_FILE = ".env.production";
export const FOUNDING_ADVISORY_LOCK = 20260909193701;
export const EXPECTED_PRODUCTION_CLOUDINARY_CLOUD_NAME = "du3othqre";

export interface FoundingCliArgs {
  allow: boolean;
  destRef: string | null;
  confirmDb: string | null;
  apply: boolean;
  confirm: string | null;
  dryRun: boolean;
  envFile: string;
  archiveRoot: string | null;
  previewRename: boolean;
}

export function parseFoundingArgs(argv: string[]): FoundingCliArgs {
  const apply = argv.includes("--apply");
  return {
    allow: parseArgValue(argv, "allow") === "1",
    destRef: parseArgValue(argv, "dest-ref") ?? null,
    confirmDb: parseArgValue(argv, "confirm-db") ?? null,
    apply,
    confirm: parseArgValue(argv, "confirm") ?? null,
    dryRun: !apply,
    envFile: parseArgValue(argv, "env-file") ?? PRODUCTION_ENV_FILE,
    archiveRoot: parseArgValue(argv, "archive-root") ?? null,
    previewRename: argv.includes("--preview-rename"),
  };
}

export function containsPreviewRef(value: string | null | undefined) {
  return Boolean(value && value.toLowerCase().includes(PREVIEW_PROJECT_REF));
}

export function assertFoundingSafety(input: {
  argv: string[];
  destConfirmDb: string;
}) {
  const args = parseFoundingArgs(input.argv);
  if (args.previewRename) {
    throw new Error("Refusing founding onboard: preview rename is a separate preview-only command.");
  }
  if (!args.allow) {
    throw new Error("Refusing founding onboard: --allow=1 is required.");
  }
  if (args.destRef !== PRODUCTION_PROJECT_REF) {
    throw new Error(
      `Refusing founding onboard: --dest-ref must be ${PRODUCTION_PROJECT_REF}.`,
    );
  }
  if (input.destConfirmDb !== PRODUCTION_CONFIRM_DB) {
    throw new Error("Refusing founding onboard: destination is not the production database.");
  }
  if (args.confirmDb !== input.destConfirmDb) {
    throw new Error("Refusing founding onboard: --confirm-db must match the production database host.");
  }
  if (args.envFile !== PRODUCTION_ENV_FILE) {
    throw new Error(`Refusing founding onboard: env file must be ${PRODUCTION_ENV_FILE}.`);
  }
  if (args.apply && args.confirm !== APPLY_CONFIRM_TOKEN) {
    throw new Error(`Refusing founding onboard: --confirm must be "${APPLY_CONFIRM_TOKEN}".`);
  }
  if (foundingDealerKeys().length !== 4) {
    throw new Error("Refusing founding onboard: allowlist must contain exactly four dealers.");
  }
  return args;
}

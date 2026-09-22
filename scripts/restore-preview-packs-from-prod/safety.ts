import { parseArgValue } from "../prod-mirror/safety";
import {
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
} from "../wipe-preview-marketplace/target";

export { PREVIEW_PROJECT_REF, PRODUCTION_PROJECT_REF };

export const PREVIEW_CONFIRM_DB = `db.${PREVIEW_PROJECT_REF}.supabase.co/postgres`;
export const APPLY_CONFIRM_TOKEN = `yes restore preview packs ${PREVIEW_PROJECT_REF}`;

export interface RestoreCliArgs {
  allow: boolean;
  sourceRef: string | null;
  destRef: string | null;
  confirmDb: string | null;
  apply: boolean;
  confirm: string | null;
  dryRun: boolean;
}

export function parseRestoreArgs(argv: string[]): RestoreCliArgs {
  const apply = argv.includes("--apply");
  return {
    allow: parseArgValue(argv, "allow") === "1",
    sourceRef: parseArgValue(argv, "source-ref") ?? null,
    destRef: parseArgValue(argv, "dest-ref") ?? null,
    confirmDb: parseArgValue(argv, "confirm-db") ?? null,
    apply,
    confirm: parseArgValue(argv, "confirm") ?? null,
    dryRun: !apply,
  };
}

export function assertRestoreSafety(input: {
  argv: string[];
  destConfirmDb: string;
}) {
  const args = parseRestoreArgs(input.argv);
  if (!args.allow) {
    throw new Error("Refusing restore: --allow=1 is required.");
  }
  if (args.sourceRef !== PRODUCTION_PROJECT_REF) {
    throw new Error(`Refusing restore: --source-ref must be ${PRODUCTION_PROJECT_REF}.`);
  }
  if (args.destRef !== PREVIEW_PROJECT_REF) {
    throw new Error(
      `Refusing restore: --dest-ref must be the preview project ${PREVIEW_PROJECT_REF}.`,
    );
  }
  if (input.destConfirmDb !== PREVIEW_CONFIRM_DB) {
    throw new Error("Refusing restore: destination is not the preview database.");
  }
  if (args.confirmDb !== input.destConfirmDb) {
    throw new Error("Refusing restore: --confirm-db must match the preview database host.");
  }
  if (args.apply && args.confirm !== APPLY_CONFIRM_TOKEN) {
    throw new Error(`Refusing restore: --confirm must be "${APPLY_CONFIRM_TOKEN}".`);
  }
  return args;
}

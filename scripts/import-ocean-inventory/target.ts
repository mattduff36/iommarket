export const IMPORT_DEALER_EMAIL = "mattduff36@gmail.com";
export const IMPORT_DEALER_NAME = "Ocean Motor Village";
export const IMPORT_REGION_SLUG = "iom-east";
export const EXPECTED_PRO_CAP = 100;

export {
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  PREVIEW_DB_HOST,
  PREVIEW_SUPABASE_HOST,
  assertPreviewWipeTarget as assertPreviewImportTarget,
  isAllowedPreviewDatabaseUrl,
  isAllowedPreviewSupabaseUrl,
  chooseWipeConnectionString as chooseImportConnectionString,
} from "../wipe-preview-marketplace/target";

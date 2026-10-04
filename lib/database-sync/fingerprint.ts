import { createHash } from "node:crypto";

export const SCHEMA_FINGERPRINT_SQL = `
SELECT line FROM (
  SELECT 'column|' || n.nspname || '|' || c.relname || '|' || a.attname || '|' ||
         format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull::text || '|' || a.atttypmod::text || '|' ||
         COALESCE(pg_get_expr(d.adbin, d.adrelid), '') AS line
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind = 'r'
    AND ((n.nspname = 'public' AND c.relname <> 'spatial_ref_sys') OR (n.nspname = 'auth' AND c.relname IN ('users', 'identities')))
  UNION ALL
  SELECT 'constraint|' || n.nspname || '|' || c.relname || '|' || f.conname || '|' || f.contype || '|' ||
         pg_get_constraintdef(f.oid) || '|' || f.condeferrable::text || '|' || f.condeferred::text
  FROM pg_constraint f
  JOIN pg_class c ON c.oid = f.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE f.contype IN ('p', 'u', 'f')
    AND ((n.nspname = 'public' AND c.relname <> 'spatial_ref_sys') OR (n.nspname = 'auth' AND c.relname IN ('users', 'identities')))
  UNION ALL
  SELECT 'enum|' || n.nspname || '|' || t.typname || '|' || e.enumlabel || '|' || e.enumsortorder::text
  FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'migration|' || migration_name || '|' || checksum
  FROM public._prisma_migrations
  WHERE rolled_back_at IS NULL AND finished_at IS NOT NULL
) fingerprint
ORDER BY line`;

export function hashSchemaLines(lines: readonly string[]): string {
  return createHash("sha256").update([...lines].sort().join("\n")).digest("hex");
}

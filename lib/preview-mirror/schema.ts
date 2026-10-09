export const MIRROR_FINGERPRINT_SQL = `
SELECT line FROM (
  SELECT 'column|' || n.nspname || '|' || c.relname || '|' || a.attname || '|' ||
         format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull::text || '|' || a.atttypmod::text || '|' ||
         COALESCE(pg_get_expr(d.adbin, d.adrelid), '') AS line
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind = 'r' AND n.nspname = 'public'
  UNION ALL
  SELECT 'constraint|' || n.nspname || '|' || c.relname || '|' || f.conname || '|' || f.contype::text || '|' ||
         pg_get_constraintdef(f.oid) || '|' || f.condeferrable::text || '|' || f.condeferred::text
  FROM pg_constraint f
  JOIN pg_class c ON c.oid = f.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND f.contype IN ('p', 'u', 'f', 'c')
  UNION ALL
  SELECT 'enum|' || n.nspname || '|' || t.typname || '|' || e.enumlabel || '|' || e.enumsortorder::text
  FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'index|' || n.nspname || '|' || t.relname || '|' || i.relname || '|' || pg_get_indexdef(i.oid)
  FROM pg_index x
  JOIN pg_class i ON i.oid = x.indexrelid
  JOIN pg_class t ON t.oid = x.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'function|' || n.nspname || '|' || p.proname || '|' || pg_get_function_identity_arguments(p.oid) || '|' || md5(pg_get_functiondef(p.oid))
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
  UNION ALL
  SELECT 'trigger|' || n.nspname || '|' || c.relname || '|' || t.tgname || '|' || pg_get_triggerdef(t.oid)
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
  UNION ALL
  SELECT 'migration|' || migration_name || '|' || checksum
  FROM public._prisma_migrations
  WHERE rolled_back_at IS NULL AND finished_at IS NOT NULL
) fingerprint
ORDER BY line`;

const SUMMARY = "Source and destination schema or migrations differ. Nothing was changed.";

/** Migration checksums are historical. Names still have to match. RLS policies are not compared. */
export function mirrorCompatibilityLine(line: string): string | null {
  if (line.startsWith("policy|")) return null;
  if (!line.startsWith("migration|")) return line;
  const name = line.split("|")[1] ?? "";
  return `migration|${name}`;
}

function normalize(lines: readonly string[]): string[] {
  return [...new Set(lines.map(mirrorCompatibilityLine).filter((line): line is string => Boolean(line)))].sort();
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((line, index) => line === right[index]);
}

export function mirrorSchemaCompatibility(sourceLines: readonly string[], destinationLines: readonly string[]) {
  const source = normalize(sourceLines);
  const destination = normalize(destinationLines);
  const schemaSource = source.filter((line) => !line.startsWith("migration|"));
  const schemaDestination = destination.filter((line) => !line.startsWith("migration|"));
  const migrationSource = source.filter((line) => line.startsWith("migration|"));
  const migrationDestination = destination.filter((line) => line.startsWith("migration|"));
  const schemaCompatible = same(schemaSource, schemaDestination);
  const migrationsCompatible = same(migrationSource, migrationDestination);
  if (schemaCompatible && migrationsCompatible) return { schemaCompatible, migrationsCompatible, blockers: [] as string[] };
  const destinationSet = new Set(destination);
  const sourceSet = new Set(source);
  const onlySource = source.filter((line) => !destinationSet.has(line)).slice(0, 6);
  const onlyDestination = destination.filter((line) => !sourceSet.has(line)).slice(0, 6);
  const blockers = [SUMMARY];
  if (onlySource.length) blockers.push(`Only in production: ${onlySource.join(" | ")}`);
  if (onlyDestination.length) blockers.push(`Only in preview: ${onlyDestination.join(" | ")}`);
  return { schemaCompatible, migrationsCompatible, blockers };
}

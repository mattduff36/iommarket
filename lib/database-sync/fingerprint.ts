import { createHash } from "node:crypto";
import { loadCloneCatalog } from "./catalog";
import { excludedSyncTable } from "./scope-policy";

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
  SELECT 'constraint|' || n.nspname || '|' || c.relname || '|' || f.conname || '|' || f.contype::text || '|' ||
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

const MISMATCH_SUMMARY = "Source and destination schema or migrations differ. Review them before copying.";
const DETAIL_LIMIT = 6;
const DETAIL_WIDTH = 220;

/** Migration checksum bytes are history, not the live schema. Names still have to match. */
export function compatibilityLine(line: string): string {
  if (!line.startsWith("migration|")) return line;
  const name = line.split("|")[1] ?? "";
  return `migration|${name}`;
}

function normalized(lines: readonly string[], kind: "schema" | "migration" | "all"): string[] {
  const enumTypes = new Set(loadCloneCatalog().flatMap((table) => table.columns.map((column) => column.typeName)));
  const selected = lines.filter((line) => {
    const parts = line.split("|");
    if ((parts[0] === "column" || parts[0] === "constraint") && parts[1] === "public" && excludedSyncTable(parts[2] ?? "")) return false;
    if (parts[0] === "enum" && parts[1] === "public" && !enumTypes.has(parts[2] ?? "")) return false;
    const migration = line.startsWith("migration|");
    if (kind === "migration") return migration;
    if (kind === "schema") return !migration;
    return true;
  }).map(compatibilityLine);
  return [...new Set(selected)].sort();
}

function sameLines(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((line, index) => line === right[index]);
}

function clip(line: string): string {
  const redacted = line.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]");
  return redacted.length > DETAIL_WIDTH ? `${redacted.slice(0, DETAIL_WIDTH - 3)}...` : redacted;
}

function sideDetail(label: string, lines: readonly string[]): string | null {
  if (lines.length === 0) return null;
  const shown = lines.slice(0, DETAIL_LIMIT).map(clip);
  const extra = lines.length > DETAIL_LIMIT ? ` (+${lines.length - DETAIL_LIMIT} more)` : "";
  return `${label}: ${shown.join(" | ")}${extra}`;
}

export function schemaCompatibility(sourceLines: readonly string[], destinationLines: readonly string[]) {
  const schemaCompatible = sameLines(normalized(sourceLines, "schema"), normalized(destinationLines, "schema"));
  const migrationsCompatible = sameLines(normalized(sourceLines, "migration"), normalized(destinationLines, "migration"));
  if (schemaCompatible && migrationsCompatible) return { schemaCompatible, migrationsCompatible, blockers: [] as string[] };
  const source = normalized(sourceLines, "all");
  const destination = normalized(destinationLines, "all");
  const destinationSet = new Set(destination);
  const sourceSet = new Set(source);
  const blockers = [MISMATCH_SUMMARY];
  const production = sideDetail("Only in production", source.filter((line) => !destinationSet.has(line)));
  const development = sideDetail("Only in development", destination.filter((line) => !sourceSet.has(line)));
  if (production) blockers.push(production);
  if (development) blockers.push(development);
  return { schemaCompatible, migrationsCompatible, blockers };
}

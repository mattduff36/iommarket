import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface PrismaMigrationFile {
  name: string;
  checksum: string;
  sql: string;
}

export function listPrismaMigrations(migrationsDir: string): PrismaMigrationFile[] {
  if (!existsSync(migrationsDir)) {
    throw new Error(`Refusing restore: migrations directory missing (${migrationsDir}).`);
  }
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{8,}/.test(entry.name))
    .map((entry) => {
      const sqlPath = join(migrationsDir, entry.name, "migration.sql");
      const sql = readFileSync(sqlPath, "utf8");
      return {
        name: entry.name,
        checksum: createHash("sha256").update(sql).digest("hex"),
        sql,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function pendingPrismaMigrations(
  available: PrismaMigrationFile[],
  appliedNames: string[],
) {
  const applied = new Set(appliedNames);
  return available.filter((migration) => !applied.has(migration.name));
}

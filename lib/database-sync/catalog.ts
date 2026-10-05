import { readFileSync } from "node:fs";
import { join } from "node:path";
import { excludedSyncTable } from "./scope-policy";

const SCALAR_TYPES = new Set(["String", "Boolean", "Int", "BigInt", "Float", "Decimal", "DateTime", "Json", "Bytes"]);

export type CatalogColumn = { name: string; typeName: string; optional: boolean; list: boolean };
export type CatalogTable = { name: string; primaryKey: string; columns: CatalogColumn[] };

export const AUTH_CLONE_TABLES = ["users", "identities"] as const;
export const INFRASTRUCTURE_TABLES = ["_prisma_migrations", "spatial_ref_sys"] as const;

export function parsePrismaCatalog(schema: string): CatalogTable[] {
  const enums = new Set([...schema.matchAll(/^enum\s+([A-Za-z0-9_]+)\s+\{/gm)].map((match) => match[1]));
  const modelNames = new Set([...schema.matchAll(/^model\s+([A-Za-z0-9_]+)\s+\{/gm)].map((match) => match[1]));
  const tables: CatalogTable[] = [];
  for (const match of schema.matchAll(/^model\s+([A-Za-z0-9_]+)\s+\{([\s\S]*?)^\}/gm)) {
    const columns: CatalogColumn[] = [];
    let primaryKey = "";
    for (const line of match[2].split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("@@") || trimmed.startsWith("//")) continue;
      const field = trimmed.match(/^([A-Za-z][A-Za-z0-9_]*)\s+([A-Za-z][A-Za-z0-9_]*)(\[\])?(\?)?(.*)$/);
      if (!field) continue;
      const [, name, typeName, list, optional, rest] = field;
      if (modelNames.has(typeName) || (!SCALAR_TYPES.has(typeName) && !enums.has(typeName))) continue;
      columns.push({ name, typeName, optional: Boolean(optional), list: Boolean(list) });
      if (rest.includes("@id")) primaryKey = name;
    }
    if (!primaryKey) throw new Error(`Prisma model ${match[1]} has no primary key.`);
    tables.push({ name: match[1], primaryKey, columns });
  }
  return tables;
}

export function loadPrismaSchema(cwd = process.cwd()): string {
  return readFileSync(join(cwd, "prisma/schema.prisma"), "utf8");
}

export function loadCloneCatalog(cwd = process.cwd()): CatalogTable[] {
  return parsePrismaCatalog(loadPrismaSchema(cwd)).filter((table) => !excludedSyncTable(table.name));
}

export function requiredPublicRelations(catalog: CatalogTable[] = loadCloneCatalog()): string[] {
  return [...catalog.map((table) => table.name), ...INFRASTRUCTURE_TABLES];
}

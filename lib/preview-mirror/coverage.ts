import { parsePrismaCatalog, loadPrismaSchema } from "@/lib/database-sync/catalog";
import { PreviewMirrorError } from "./error";

export function requiredMirrorTables(cwd = process.cwd()): string[] {
  return [...parsePrismaCatalog(loadPrismaSchema(cwd)).map((table) => table.name), "_prisma_migrations"];
}

export function assertSamePublicCatalog(sourceTables: readonly string[], destinationTables: readonly string[], required: readonly string[]): void {
  const source = [...sourceTables].sort();
  const destination = [...destinationTables].sort();
  if (source.join("\n") !== destination.join("\n")) {
    throw new PreviewMirrorError("Source and destination public tables differ. Nothing was changed.");
  }
  const present = new Set(source);
  const missing = required.filter((table) => !present.has(table));
  if (missing.length) {
    throw new PreviewMirrorError(`The public catalog is missing application tables (${missing.slice(0, 5).join(", ")}). Nothing was changed.`);
  }
}

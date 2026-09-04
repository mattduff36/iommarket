import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { sha256Buffer, type BackupManifest } from "../prod-mirror/manifest";
import { PREVIEW_PROJECT_REF, PRODUCTION_PROJECT_REF } from "../wipe-preview-marketplace/target";

export const PRIVATE_BACKUPS_ROOT = "private/db-backups";

export interface VerifiedBackup {
  kind: "preview" | "production";
  dir: string;
  manifest: BackupManifest;
}

function readManifest(dir: string): BackupManifest {
  const path = join(dir, "manifest.json");
  if (!existsSync(path)) {
    throw new Error(`Refusing rebuild: missing manifest in ${dir}.`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as BackupManifest;
}

function verifyManifestFiles(dir: string, manifest: BackupManifest) {
  if (!manifest.files?.length) {
    throw new Error(`Refusing rebuild: backup ${manifest.id} has no files.`);
  }
  for (const file of manifest.files) {
    const path = join(dir, file.name);
    if (!existsSync(path)) {
      throw new Error(`Refusing rebuild: missing ${file.name} in ${manifest.id}.`);
    }
    const bytes = statSync(path).size;
    if (bytes <= 0 || bytes !== file.bytes) {
      throw new Error(`Refusing rebuild: size mismatch for ${file.name}.`);
    }
    const actual = sha256Buffer(readFileSync(path));
    if (actual !== file.sha256) {
      throw new Error(`Refusing rebuild: hash mismatch for ${file.name}.`);
    }
  }
}

function latestBackupDir(root: string, prefix: string) {
  if (!existsSync(root)) {
    throw new Error(`Refusing rebuild: ${root} does not exist.`);
  }
  const matches: string[] = [];
  for (const dateDir of readdirSync(root)) {
    const dated = join(root, dateDir);
    if (!statSync(dated).isDirectory()) continue;
    for (const name of readdirSync(dated)) {
      if (name.startsWith(prefix)) matches.push(join(dated, name));
    }
  }
  if (matches.length === 0) {
    throw new Error(`Refusing rebuild: no ${prefix} backup under ${root}.`);
  }
  return matches.sort().at(-1)!;
}

export function verifyPairedBackups(cwd = process.cwd()) {
  const root = resolve(cwd, PRIVATE_BACKUPS_ROOT);
  const previewDir = latestBackupDir(root, `preview-${PREVIEW_PROJECT_REF}-`);
  const productionDir = latestBackupDir(root, `production-${PRODUCTION_PROJECT_REF}-`);
  const previewManifest = readManifest(previewDir);
  const productionManifest = readManifest(productionDir);
  if (previewManifest.targetRef !== PREVIEW_PROJECT_REF) {
    throw new Error("Refusing rebuild: preview backup targetRef mismatch.");
  }
  if (productionManifest.targetRef !== PRODUCTION_PROJECT_REF) {
    throw new Error("Refusing rebuild: production backup targetRef mismatch.");
  }
  verifyManifestFiles(previewDir, previewManifest);
  verifyManifestFiles(productionDir, productionManifest);
  return {
    preview: {
      kind: "preview" as const,
      dir: previewDir,
      manifest: previewManifest,
    },
    production: {
      kind: "production" as const,
      dir: productionDir,
      manifest: productionManifest,
    },
  };
}

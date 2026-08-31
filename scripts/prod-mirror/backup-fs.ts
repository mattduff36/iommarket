import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { BACKUPS_DIR } from "./constants";
import { createBackupManifest, fileRecord, type BackupManifest } from "./manifest";
import { STORAGE_COPY_PROOF_FILE, type StorageCopyProof } from "./storage-proof";

export function backupsRoot(cwd = process.cwd()) {
  return resolve(cwd, BACKUPS_DIR);
}

export function createBackupDir(id: string, cwd = process.cwd()) {
  const dir = join(backupsRoot(cwd), id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeBackupFile(dir: string, name: string, contents: string | Buffer) {
  const path = join(dir, name);
  writeFileSync(path, contents);
  return fileRecord(name, contents);
}

export function writeManifest(dir: string, manifest: BackupManifest) {
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

export function readManifest(dir: string): BackupManifest {
  return JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as BackupManifest;
}

export function findBackupDir(backupId: string, cwd = process.cwd()) {
  const dir = join(backupsRoot(cwd), backupId);
  if (!existsSync(join(dir, "manifest.json"))) {
    throw new Error(`Refusing mirror: backup ${backupId} was not found.`);
  }
  return dir;
}

export function writeStorageCopyProof(dir: string, proof: StorageCopyProof) {
  writeFileSync(join(dir, STORAGE_COPY_PROOF_FILE), `${JSON.stringify(proof, null, 2)}\n`);
}

export function readStorageCopyProof(dir: string): StorageCopyProof | null {
  const path = join(dir, STORAGE_COPY_PROOF_FILE);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as StorageCopyProof;
}

export function createBackupManifestForDir(input: {
  id: string;
  targetRef: string;
  confirmDb: string;
  dir: string;
  files: ReturnType<typeof fileRecord>[];
}) {
  const manifest = createBackupManifest({
    id: input.id,
    targetRef: input.targetRef,
    confirmDb: input.confirmDb,
    files: input.files,
  });
  writeManifest(input.dir, manifest);
  return manifest;
}

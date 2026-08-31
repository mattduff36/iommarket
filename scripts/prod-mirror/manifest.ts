import { createHash } from "node:crypto";
import { WORKSTREAM_ID } from "./constants";

export interface BackupFileRecord {
  name: string;
  sha256: string;
  bytes: number;
}

export interface BackupManifest {
  id: string;
  workstream: typeof WORKSTREAM_ID;
  targetRef: string;
  confirmDb: string;
  createdAt: string;
  files: BackupFileRecord[];
}

export function sha256Buffer(contents: Buffer | string) {
  return createHash("sha256").update(contents).digest("hex");
}

export function createBackupManifest(input: {
  id: string;
  targetRef: string;
  confirmDb: string;
  createdAt?: string;
  files: BackupFileRecord[];
}): BackupManifest {
  return {
    id: input.id,
    workstream: WORKSTREAM_ID,
    targetRef: input.targetRef,
    confirmDb: input.confirmDb,
    createdAt: input.createdAt ?? new Date().toISOString(),
    files: input.files,
  };
}

export function assertBackupMatchesConfirmation(
  manifest: BackupManifest,
  backupId: string,
  confirmDb: string,
) {
  if (manifest.workstream !== WORKSTREAM_ID) {
    throw new Error("Refusing mirror: backup workstream mismatch.");
  }
  if (manifest.id !== backupId) {
    throw new Error("Refusing mirror: --backup-id does not match dump metadata.");
  }
  if (manifest.confirmDb !== confirmDb) {
    throw new Error("Refusing mirror: --confirm-db does not match dump metadata.");
  }
}

export function fileRecord(name: string, contents: Buffer | string): BackupFileRecord {
  const buffer = typeof contents === "string" ? Buffer.from(contents, "utf8") : contents;
  return {
    name,
    sha256: sha256Buffer(buffer),
    bytes: buffer.byteLength,
  };
}

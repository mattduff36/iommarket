import { copyFileSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FoundingDealerKey } from "./allowlist";

export interface FoundingCredential {
  dealerKey: FoundingDealerKey;
  email: string;
  password: string;
}

export interface FoundingRunManifest {
  runId: string;
  phase: "credentials" | "snapshots" | "media" | "auth" | "db" | "postflight";
  dbCommitted: boolean;
  archive: Record<string, { runId: string; checksum: string }>;
  authUserIds: Record<string, string>;
  createdAuthUserIds: string[];
  cloudinaryPublicIds: string[];
  listingSlugs: string[];
  grant: Record<string, { startsAt: string; endsAt: string; kind: "create" | "preserve" }>;
  counts: Record<string, { imported: number; skipped: number; overflow: number }>;
}

export function foundingPrivateDir(cwd = process.cwd()) {
  return join(cwd, "private", "founding-dealers");
}

export function credentialsPath(runId: string, cwd = process.cwd()) {
  return join(foundingPrivateDir(cwd), runId, "credentials.json");
}

export function manifestPath(runId: string, cwd = process.cwd()) {
  return join(foundingPrivateDir(cwd), runId, "manifest.json");
}

export function writeAtomicJson(filePath: string, value: unknown) {
  mkdirSync(dirname(filePath), { recursive: true });
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, payload, { encoding: "utf8", mode: 0o600 });
  try {
    renameSync(tmp, filePath);
  } catch {
    copyFileSync(tmp, filePath);
    unlinkSync(tmp);
  }
}

export function writeCredentials(runId: string, credentials: FoundingCredential[], cwd = process.cwd()) {
  writeAtomicJson(credentialsPath(runId, cwd), {
    runId,
    createdAt: new Date().toISOString(),
    credentials,
  });
  return credentialsPath(runId, cwd);
}

export function writeManifest(runId: string, manifest: FoundingRunManifest, cwd = process.cwd()) {
  writeAtomicJson(manifestPath(runId, cwd), redactManifest(manifest));
  return manifestPath(runId, cwd);
}

export function redactManifest(manifest: FoundingRunManifest): FoundingRunManifest {
  return manifest;
}

export function createEmptyManifest(runId: string): FoundingRunManifest {
  return {
    runId,
    phase: "credentials",
    dbCommitted: false,
    archive: {},
    authUserIds: {},
    createdAuthUserIds: [],
    cloudinaryPublicIds: [],
    listingSlugs: [],
    grant: {},
    counts: {},
  };
}

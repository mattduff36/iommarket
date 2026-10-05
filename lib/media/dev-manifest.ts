import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { isDisposableDestinationPath } from "@/lib/media/config";

export interface DevManifestEntry {
  fileId: string;
  filePath: string;
  purpose: "dev-upload" | "mutation-test";
  createdAt: string;
}

function manifestPath(env: NodeJS.ProcessEnv = process.env) {
  const path = env.IMAGEKIT_DEV_MANIFEST;
  if (!path) throw new Error("ImageKit development manifest path is not configured.");
  return path;
}

export function readDevManifest(env: NodeJS.ProcessEnv = process.env): DevManifestEntry[] {
  const path = manifestPath(env);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as DevManifestEntry)
    .filter((entry) => entry.fileId && isDisposableDestinationPath(entry.filePath));
}

export function appendDevManifest(entry: DevManifestEntry, env: NodeJS.ProcessEnv = process.env) {
  if (!isDisposableDestinationPath(entry.filePath)) {
    throw new Error("Refusing to record a file outside the disposable development folder.");
  }
  const path = manifestPath(env);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
}

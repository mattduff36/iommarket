import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { findBackupDir, readManifest, writeStorageCopyProof } from "./backup-fs";
import { loadMirrorEnvs, productionCandidates } from "./cli-env";
import { PREVIEW_PROJECT_REF, PRODUCTION_PROJECT_REF, STORAGE_BUCKET } from "./constants";
import { assertBackupMatchesConfirmation } from "./manifest";
import { assertMirrorSafety } from "./safety";
import {
  STORAGE_LIST_PAGE_SIZE,
  assertStorageCopyEquivalent,
  createStorageCopyProof,
  nextStorageListOffset,
  type StorageObjectProof,
} from "./storage-proof";
import { chooseRestoreConnectionString, isAllowedSupabaseApiUrl, redactedConfirmDb } from "./target";

async function listAllFiles(
  client: SupabaseClient,
  bucket: string,
  path = "",
): Promise<StorageObjectProof[]> {
  const files: StorageObjectProof[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await client.storage.from(bucket).list(path, {
      limit: STORAGE_LIST_PAGE_SIZE,
      offset,
    });
    if (error) {
      throw new Error(`Failed to list ${bucket}/${path}: ${error.message}`);
    }
    const page = data ?? [];
    for (const item of page) {
      const fullPath = path ? `${path}/${item.name}` : item.name;
      if (!item.metadata) {
        files.push(...(await listAllFiles(client, bucket, fullPath)));
        continue;
      }
      files.push({
        path: fullPath,
        size: Number(item.metadata.size ?? 0),
        etag: typeof item.metadata.eTag === "string" ? item.metadata.eTag : undefined,
      });
    }
    const next = nextStorageListOffset(page.length, STORAGE_LIST_PAGE_SIZE, offset);
    if (next === null) break;
    offset = next;
  }
  return files;
}

function adminClient(url: string, serviceRoleKey: string) {
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function runCopyStorage(argv: string[], cwd = process.cwd()) {
  const envs = loadMirrorEnvs(argv, cwd);
  if (!envs.preview.supabaseUrl || !envs.preview.serviceRoleKey) {
    throw new Error("Refusing storage copy: preview Supabase URL and service role are required.");
  }
  if (!envs.production.supabaseUrl || !envs.production.serviceRoleKey) {
    throw new Error("Refusing storage copy: production Supabase URL and service role are required.");
  }
  if (!isAllowedSupabaseApiUrl(envs.preview.supabaseUrl, PREVIEW_PROJECT_REF)) {
    throw new Error("Refusing storage copy: preview Supabase URL is not the preview project.");
  }
  if (!isAllowedSupabaseApiUrl(envs.production.supabaseUrl, PRODUCTION_PROJECT_REF)) {
    throw new Error("Refusing storage copy: production Supabase URL is not the production project.");
  }

  const productionDb = chooseRestoreConnectionString(productionCandidates(envs.production));
  const confirmDb = redactedConfirmDb(productionDb);
  const backupId = argv.find((arg) => arg.startsWith("--backup-id="))?.slice("--backup-id=".length);
  if (!backupId) throw new Error("Refusing storage copy: --backup-id is required.");
  const manifest = readManifest(findBackupDir(backupId, cwd));
  assertBackupMatchesConfirmation(manifest, backupId, confirmDb);
  assertMirrorSafety({
    argv,
    writeConfirmDb: confirmDb,
    backupId: manifest.id,
    backupConfirmDb: manifest.confirmDb,
  });

  const source = adminClient(envs.preview.supabaseUrl, envs.preview.serviceRoleKey);
  const dest = adminClient(envs.production.supabaseUrl, envs.production.serviceRoleKey);

  const { data: destBucket, error: destBucketError } = await dest.storage.getBucket(STORAGE_BUCKET);
  if (destBucketError && !destBucketError.message.toLowerCase().includes("not found")) {
    throw new Error(`Failed to inspect production bucket: ${destBucketError.message}`);
  }
  if (!destBucket) {
    const { error } = await dest.storage.createBucket(STORAGE_BUCKET, { public: true });
    if (error) throw new Error(`Failed to create production bucket: ${error.message}`);
  }

  const sourceFiles = await listAllFiles(source, STORAGE_BUCKET);
  for (const file of sourceFiles) {
    const downloaded = await source.storage.from(STORAGE_BUCKET).download(file.path);
    if (downloaded.error || !downloaded.data) {
      throw new Error(`Download failed for ${file.path}: ${downloaded.error?.message}`);
    }
    const uploaded = await dest.storage.from(STORAGE_BUCKET).upload(file.path, downloaded.data, {
      upsert: true,
      contentType: downloaded.data.type || undefined,
    });
    if (uploaded.error) {
      throw new Error(`Upload failed for ${file.path}: ${uploaded.error.message}`);
    }
  }
  const destFiles = await listAllFiles(dest, STORAGE_BUCKET);
  assertStorageCopyEquivalent(sourceFiles, destFiles);
  writeStorageCopyProof(findBackupDir(backupId, cwd), createStorageCopyProof(STORAGE_BUCKET, destFiles));
  process.stdout.write(
    `Storage copy complete. objects=${sourceFiles.length} bucket=${STORAGE_BUCKET}\n`,
  );
  return { objects: sourceFiles.length };
}

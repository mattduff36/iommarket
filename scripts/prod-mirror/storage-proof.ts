export const STORAGE_LIST_PAGE_SIZE = 1000;
export const STORAGE_COPY_PROOF_FILE = "storage-copy-proof.json";

export interface StorageObjectProof {
  path: string;
  size: number;
  etag?: string;
  checksum?: string;
}

export interface StorageCopyProof {
  equivalent: true;
  bucket: string;
  objectCount: number;
  paths: string[];
}

function proofKey(file: StorageObjectProof) {
  return file.path.replace(/^\/+/, "");
}

export function nextStorageListOffset(received: number, limit: number, offset: number): number | null {
  if (received < limit) return null;
  return offset + limit;
}

export function assertStorageCopyEquivalent(
  source: StorageObjectProof[],
  dest: StorageObjectProof[],
) {
  if (source.length !== dest.length) {
    throw new Error(
      `Storage copy mismatch: source objects=${source.length} dest objects=${dest.length}`,
    );
  }
  const destByPath = new Map(dest.map((file) => [proofKey(file), file]));
  for (const file of source) {
    const copied = destByPath.get(proofKey(file));
    if (!copied) {
      throw new Error(`Storage copy missing path: ${file.path}`);
    }
    if (copied.size !== file.size) {
      throw new Error(`Storage copy size mismatch for ${file.path}: ${file.size} -> ${copied.size}`);
    }
    if (file.etag && copied.etag && file.etag !== copied.etag) {
      throw new Error(`Storage copy ETag mismatch for ${file.path}`);
    }
    if (file.checksum && copied.checksum && file.checksum !== copied.checksum) {
      throw new Error(`Storage copy checksum mismatch for ${file.path}`);
    }
  }
}

export function createStorageCopyProof(
  bucket: string,
  files: StorageObjectProof[],
): StorageCopyProof {
  return {
    equivalent: true,
    bucket,
    objectCount: files.length,
    paths: files.map((file) => proofKey(file)).sort(),
  };
}

export function assertStorageProofReady(proof: StorageCopyProof | null | undefined) {
  if (!proof || proof.equivalent !== true) {
    throw new Error(
      "Refusing URL rewrite: storage copy proof is required before rewriting media URLs.",
    );
  }
  if (proof.objectCount !== proof.paths.length) {
    throw new Error("Refusing URL rewrite: storage copy proof is incomplete.");
  }
}

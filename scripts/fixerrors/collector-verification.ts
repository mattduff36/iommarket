import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blobAtRef, isAncestor, runGit, type GitRunner } from "./git-policy";

export function gitContentHash(content: Buffer): string {
  return createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
}

/** Invocation-local cache; refs are immutable SHAs and local bytes are re-read, never trusted across runs. */
export function createCollectorVerifier(input: {
  productionSha: string; stagingSha: string; deployed: boolean; cwd: string; run?: GitRunner;
}) {
  const blobs = new Map<string, string | null>();
  const localHashes = new Map<string, { contentHash: string; blob: string }>();
  const at = (sha: string, file: string) => {
    const key = `${sha}:${file}`;
    if (!blobs.has(key)) blobs.set(key, blobAtRef(sha, file, input.cwd, input.run));
    return blobs.get(key);
  };
  const candidates = new Map<string, boolean>();
  return async (sha: string, paths: string[], candidate?: string) => {
    if (!input.deployed || sha !== input.productionSha) return false;
    if (candidate) {
      if (!candidates.has(candidate)) candidates.set(candidate,
        isAncestor(candidate, input.productionSha, input.cwd, input.run));
      if (!candidates.get(candidate)) return false;
      return paths.every(file => {
        const reviewed = at(candidate, file);
        return reviewed !== null && reviewed === at(input.productionSha, file);
      });
    }
    return paths.every(file => {
      const contentHash = gitContentHash(readFileSync(resolve(input.cwd, file)));
      if (localHashes.get(file)?.contentHash !== contentHash) {
        // Git applies the same attributes/line-ending filters used by the committed blob.
        const result = (input.run ?? runGit)(["hash-object", "--", file], input.cwd);
        if (result.status !== 0 || !/^[a-f0-9]{40}$/.test(result.stdout.trim())) throw new Error("Collector local Git hash could not be read");
        localHashes.set(file, { contentHash, blob: result.stdout.trim() });
      }
      const local = localHashes.get(file)!.blob;
      const deployed = at(input.productionSha, file);
      return deployed === local && deployed === at(input.stagingSha, file);
    });
  };
}

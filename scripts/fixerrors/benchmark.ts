import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { createCollectorVerifier, gitContentHash } from "./collector-verification";
import { buildSourceIndex } from "./source-extraction";
import { runGit, type GitRunner } from "./git-policy";

/** Offline only: a disposable synthetic repository, no environment loading or network/database calls. */
async function benchmark() {
  const root = mkdtempSync(join(tmpdir(), "fixerrors-benchmark-"));
  try {
    const write = (file: string, text: string) => {
      const path = join(root, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    };
    const configs = Array.from({ length: 10 }, (_, i) => Array.from({ length: i < 2 ? 4 : 3 }, (_, j) => `lib/collector-${i}-${j}.ts`));
    for (const path of configs.flat()) write(path, "export const collector = true;\n");
    for (let i = 0; i < 300; i++) write(`app/route-${i}/page.tsx`, "export default function Page() { return null; }\n");
    execFileSync("git", ["init", "--quiet", root], { timeout: 30_000, windowsHide: true });
    const object = (args: string[], input: string) => execFileSync("git", ["-C", root, ...args],
      { input, encoding: "utf8", timeout: 30_000, windowsHide: true }).trim();
    // Build disposable objects directly: never use an index, commits, hooks or the real repository.
    const blob = object(["hash-object", "-w", "--stdin"], "export const collector = true;\n");
    const pageBlob = object(["hash-object", "-w", "--stdin"], "export default function Page() { return null; }\n");
    const libTree = object(["mktree"], configs.flat().map(path => `100644 blob ${blob}\t${path.slice(4)}\n`).join(""));
    const pageTree = object(["mktree"], `100644 blob ${pageBlob}\tpage.tsx\n`);
    const appTree = object(["mktree"], Array.from({ length: 300 }, (_, i) => `040000 tree ${pageTree}\troute-${i}\n`).join(""));
    const productionSha = object(["mktree"], `040000 tree ${appTree}\tapp\n040000 tree ${libTree}\tlib\n`);
    write("lib/staging-only.ts", "export const staging = true;\n");
    const stagingBlob = object(["hash-object", "-w", "--stdin"], "export const staging = true;\n");
    const stagingLib = object(["mktree"], configs.flat().map(path => `100644 blob ${blob}\t${path.slice(4)}\n`).join("")
      + `100644 blob ${stagingBlob}\tstaging-only.ts\n`);
    const stagingSha = object(["mktree"], `040000 tree ${appTree}\tapp\n040000 tree ${stagingLib}\tlib\n`);
    const issueConfigs = configs.flatMap((paths, i) => Array.from({ length: [7, 7, 11, 11, 11, 11, 10, 10, 10, 10][i] }, () => paths));
    assert.equal(issueConfigs.length, 98);
    assert.equal(issueConfigs.flat().length, 308);
    let beforeProcesses = 0, afterProcesses = 0;
    const beforeRun: GitRunner = (args, cwd) => { beforeProcesses++; return runGit(args, cwd); };
    const afterRun: GitRunner = (args, cwd) => { afterProcesses++; return runGit(args, cwd); };
    const beforeStart = performance.now();
    for (const paths of issueConfigs) {
      buildSourceIndex(root);
      for (const path of paths) {
        const local = beforeRun(["hash-object", "--", path], root).stdout.trim();
        for (const sha of [productionSha, stagingSha]) {
          const result = beforeRun(["rev-parse", `${sha}:${path}`], root);
          assert.equal(result.status, 0);
          assert.equal(result.stdout.trim(), local);
        }
      }
    }
    const beforeMs = performance.now() - beforeStart;
    const verify = createCollectorVerifier({ productionSha, stagingSha, deployed: true, cwd: root, run: afterRun });
    const afterStart = performance.now();
    buildSourceIndex(root);
    for (const paths of issueConfigs) assert.equal(await verify(productionSha, paths), true);
    const afterMs = performance.now() - afterStart;
    assert.equal(gitContentHash(readFileSync(join(root, configs[0][0]))), beforeRun(["hash-object", "--", configs[0][0]], root).stdout.trim());
    beforeProcesses--; // Exclude the independent correctness assertion from measured work.
    console.info(JSON.stringify({
      workload: { issues: 98, collectorConfigurations: 10, pathReferences: 308, uniquePaths: 32, sourceFiles: 333 },
      before: { elapsedMs: Math.round(beforeMs), gitProcesses: beforeProcesses, sourceWalks: 98 },
      after: { elapsedMs: Math.round(afterMs), gitProcesses: afterProcesses, sourceWalks: 1 },
      scope: "Single offline synthetic run; real local filesystem and Git, no network/database/deployment claims. Timings include Windows process launch costs.",
    }, null, 2));
  } finally { rmSync(root, { recursive: true, force: true }); }
}

benchmark().catch(error => { console.error(error instanceof Error ? error.message : "Offline benchmark failed"); process.exitCode = 1; });

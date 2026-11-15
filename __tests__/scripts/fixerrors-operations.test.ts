import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createCollectorVerifier, gitContentHash } from "@/scripts/fixerrors/collector-verification";
import { fixerrorsTimeouts, runBoundedProcess, timeStage } from "@/scripts/fixerrors/operations";
import { createFixerrorsClient } from "@/scripts/fixerrors/db";
import { runGit } from "@/scripts/fixerrors/git-policy";

const pgClient = vi.hoisted(() => vi.fn(function () {}));
vi.mock("pg", () => ({ default: { Client: pgClient } }));

describe("bounded fixerrors operations", () => {
  it("validates configurable deadlines and reports a killed subprocess explicitly", () => {
    expect(() => fixerrorsTimeouts({ FIXERRORS_GIT_TIMEOUT_MS: "0" })).toThrow(/FIXERRORS_GIT_TIMEOUT_MS/);
    expect(() => fixerrorsTimeouts({ FIXERRORS_QUERY_TIMEOUT_MS: "NaN" })).toThrow();
    expect(() => runBoundedProcess(process.execPath, ["-e", "setTimeout(()=>{},10000)"], { timeout: 30, label: "synthetic timeout" })).toThrow(/synthetic timeout.*timed out/i);
  });
  it("reports failed stage duration without success-shaped fallback", async () => {
    const log = vi.fn();
    await expect(timeStage("synthetic query", async () => { throw new Error("failure"); }, log)).rejects.toThrow("failure");
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/synthetic query.*failed.*ms/));
  });
  it("passes bounded deadlines to pg without connecting or reading an environment file", () => {
    createFixerrorsClient({ POSTGRES_URL_NON_POOLING: "postgresql://test@localhost/offline",
      FIXERRORS_CONNECT_TIMEOUT_MS: "1100", FIXERRORS_QUERY_TIMEOUT_MS: "2200",
      FIXERRORS_STATEMENT_TIMEOUT_MS: "1800", FIXERRORS_LOCK_TIMEOUT_MS: "900" });
    expect(pgClient).toHaveBeenLastCalledWith(expect.objectContaining({
      connectionTimeoutMillis: 1100, query_timeout: 2200, statement_timeout: 1800,
      lock_timeout: 900, idle_in_transaction_session_timeout: 2200, ssl: false,
    }));
    expect(() => createFixerrorsClient({ POSTGRES_URL_NON_POOLING: "postgresql://test@localhost/offline",
      FIXERRORS_LOCK_TIMEOUT_MS: "600001" })).toThrow(/FIXERRORS_LOCK_TIMEOUT_MS/);
  });
  it("pins collector reads to SHAs and invalidates local and invocation caches", async () => {
    const root = mkdtempSync(join(tmpdir(), "collector-cache-"));
    try {
      const file = join(root, "collector.ts");
      writeFileSync(file, "first");
      const hash = gitContentHash(Buffer.from("first"));
      const run = vi.fn((args: string[], _cwd: string) => ({ status: 0,
        stdout: args[0] === "hash-object" ? gitContentHash(readFileSync(file)) : hash, stderr: "" }));
      const args = { productionSha: "a".repeat(40), stagingSha: "b".repeat(40), deployed: true, cwd: root, run };
      const verify = createCollectorVerifier(args);
      expect(await verify(args.productionSha, ["collector.ts"])).toBe(true);
      expect(await verify(args.productionSha, ["collector.ts"])).toBe(true);
      expect(run).toHaveBeenCalledTimes(3);
      expect(run.mock.calls[1]).toEqual([["rev-parse", `${args.productionSha}:collector.ts`], root]);
      writeFileSync(file, "changed");
      expect(await verify(args.productionSha, ["collector.ts"])).toBe(false);
      writeFileSync(file, "first");
      expect(await verify(args.productionSha, ["collector.ts"])).toBe(true);
      expect(await createCollectorVerifier(args)(args.productionSha, ["collector.ts"])).toBe(true);
      expect(run).toHaveBeenCalledTimes(8);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("preserves Git CRLF normalization when comparing local collector bytes", async () => {
    const root = mkdtempSync(join(tmpdir(), "collector-crlf-"));
    try {
      execFileSync("git", ["init", "--quiet", root], { windowsHide: true, timeout: 30_000 });
      execFileSync("git", ["-C", root, "config", "--local", "core.autocrlf", "true"], { windowsHide: true, timeout: 30_000 });
      writeFileSync(join(root, "collector.ts"), "first\r\n");
      const hash = gitContentHash(Buffer.from("first\n"));
      const run = vi.fn((args: string[], cwd: string) => args[0] === "hash-object"
        ? runGit(args, cwd) : { status: 0, stdout: hash, stderr: "" });
      const verify = createCollectorVerifier({ productionSha: "a".repeat(40), stagingSha: "b".repeat(40), deployed: true, cwd: root, run });
      expect(await verify("a".repeat(40), ["collector.ts"])).toBe(true);
      writeFileSync(join(root, "collector.ts"), "changed\r\n");
      expect(await verify("a".repeat(40), ["collector.ts"])).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

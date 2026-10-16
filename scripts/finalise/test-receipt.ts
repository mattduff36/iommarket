import { createHash } from "crypto";
import { execFileSync } from "child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "fs";
import path from "path";

const MAX_AGE = 24 * 60 * 60 * 1000;
function receiptPath(root: string) {
  const gitPath = execFileSync("git", ["rev-parse", "--git-path", "finalise-test-success.json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  return path.resolve(root, gitPath);
}

/** Fail closed if a complete input snapshot cannot be obtained. Never store environment values. */
export function testInputFingerprint(root: string): string | null {
  try {
    const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).split("\0").filter(Boolean);
    files.push(...readdirSync(root).filter((name) => name.startsWith(".env")));
    files.push("node_modules/.package-lock.json");
    const hash = createHash("sha256");
    const env = Object.entries(process.env).filter(([key]) => !/^(npm_lifecycle_event|npm_lifecycle_script|npm_command|INIT_CWD|SKIP_CURSOR_USAGE|FINALISE_FORCE_TESTS|_)$/i.test(key)).sort(([a], [b]) => a.localeCompare(b));
    hash.update(JSON.stringify({ version: 1, root: path.resolve(root), node: process.version, platform: process.platform, arch: process.arch, command: "npm run test:run", env }));
    for (const file of [...new Set(files)].sort()) {
      const absolute = path.join(root, file);
      hash.update(JSON.stringify(file));
      if (!existsSync(absolute)) { hash.update("missing"); continue; }
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) { hash.update(readlinkSync(absolute)); throw new Error("Symlink input requires fresh verification"); }
      if (!stat.isFile()) throw new Error("Non-file input requires fresh verification");
      hash.update(String(stat.mode));
      hash.update(readFileSync(absolute));
    }
    return hash.digest("hex");
  } catch { return null; }
}

/** Only a successful, unchanged full suite is reusable; failures and interrupted runs leave no receipt. */
export function runVerifiedTests(root: string, action: () => void, now = Date.now()) {
  let file: string;
  try { file = receiptPath(root); } catch { action(); return; }
  const before = testInputFingerprint(root);
  try {
    const receipt = JSON.parse(readFileSync(file, "utf8"));
    const age = now - receipt.completedAt;
    if (process.env.FINALISE_FORCE_TESTS !== "1" && before && receipt.version === 1 && receipt.fingerprint === before && age >= 0 && age < MAX_AGE) {
      process.stdout.write("Reusing successful npm run test:run result: identical inputs, less than 24 hours old.\n");
      return;
    }
  } catch { /* Missing or malformed receipts require fresh tests. */ }
  rmSync(file, { force: true });
  action();
  const after = testInputFingerprint(root);
  if (before && before === after) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ version: 1, fingerprint: after, completedAt: Date.now() }) + "\n");
  }
}

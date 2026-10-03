#!/usr/bin/env node
/** Installs the repository git hooks into .git/hooks. */
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const hooks = ["pre-commit", "pre-push"];
const source = path.join("scripts", "git-hooks");

let gitHooksPath;
try {
  gitHooksPath = execFileSync("git", ["rev-parse", "--git-path", "hooks"], {
    encoding: "utf8",
  }).trim();
} catch {
  process.stderr.write("install-git-hooks: not a git working tree; nothing to do.\n");
  process.exit(0);
}

const target = path.resolve(gitHooksPath);
mkdirSync(target, { recursive: true });
for (const hook of hooks) {
  const from = path.join(source, hook);
  const to = path.join(target, hook);
  copyFileSync(from, to);
  chmodSync(to, 0o755);
  process.stdout.write(`install-git-hooks: installed ${hook}\n`);
}

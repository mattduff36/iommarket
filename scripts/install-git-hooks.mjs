#!/usr/bin/env node
/** Installs the repository git hooks into .git/hooks. */
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const hooks = ["pre-commit"];
const source = path.join("scripts", "git-hooks");
const target = path.join(".git", "hooks");

if (!existsSync(".git")) {
  process.stderr.write("install-git-hooks: not a git working tree; nothing to do.\n");
  process.exit(0);
}

mkdirSync(target, { recursive: true });
for (const hook of hooks) {
  const from = path.join(source, hook);
  const to = path.join(target, hook);
  copyFileSync(from, to);
  chmodSync(to, 0o755);
  process.stdout.write(`install-git-hooks: installed ${hook}\n`);
}

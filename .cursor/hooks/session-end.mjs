#!/usr/bin/env node
/**
 * Session-end collection. Always returns an empty hook response and never asks
 * the agent to continue.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function drain() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

await drain().catch(() => "");
const result = spawnSync(
  process.execPath,
  [
    "--env-file-if-exists=.env.local",
    "--experimental-sqlite",
    "scripts/cursor-usage/collect.mjs",
    "--bounded",
  ],
  { cwd: root, encoding: "utf8", timeout: 45_000 },
);
if (result.stdout) process.stderr.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) process.stderr.write(`cursor-usage: ${result.error.message}\n`);
process.stdout.write("{}\n");

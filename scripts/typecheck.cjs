/* eslint-disable @typescript-eslint/no-require-imports -- Bootstrap must run before TypeScript/module resolution. */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const env = { ...process.env };
if (process.platform === "win32") {
  try {
    fs.realpathSync.native(process.cwd());
  } catch (error) {
    if (error.code !== "EPERM") throw error;
    fs.realpathSync(process.cwd());
    const preload = path.join(__dirname, "typecheck-realpath.cjs").split(path.sep).join("/");
    env.NODE_OPTIONS = [env.NODE_OPTIONS, '--require="' + preload + '"'].filter(Boolean).join(" ");
    env.__NEXT_NODE_NATIVE_TS_LOADER_ENABLED = "true";
  }
}

for (const [binary, ...args] of [
  ["prisma/build/index.js", "generate"],
  ["next/dist/bin/next", "typegen"],
  ["typescript/bin/tsc", "--noEmit"],
]) {
  const result = spawnSync(process.execPath, [require.resolve(binary), ...args], { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/** Export only reviewed worker sources and their locked public runtime dependency tree. */
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, mkdtempSync } from "node:fs";
import { dirname, resolve, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { ALLOWED_RUNTIME_SOURCES, ALLOWED_RUNTIME_PACKAGES, assertRuntimeSource, assertRuntimeLock, verifyRuntimePayload } from "./runtime-boundary.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const base = resolve(repo, "private/oracle-stock-build");
mkdirSync(base, {recursive:true});
const out = mkdtempSync(resolve(base,"release-"));
const worker = resolve(out,"worker");
const lock = JSON.parse(readFileSync(resolve(repo,"package-lock.json"),"utf8"));
const packages = {};
function include(path) {
  if (packages[path]) return;
  const entry = lock.packages[path];
  if (!entry || !entry.integrity || !entry.resolved?.startsWith("https://registry.npmjs.org/")) throw new Error("Missing public npm integrity for " + path);
  const {dev, devOptional, ...productionEntry} = entry;
  packages[path] = productionEntry;
  const names = {...entry.dependencies, ...entry.optionalDependencies, ...entry.peerDependencies};
  for (const name of Object.keys(names)) {
    let dir = path;
    let key;
    while (true) {
      const candidate = posix.join(dir,"node_modules",name);
      if (lock.packages[candidate]) { key = candidate; break; }
      if (!dir) break;
      const parent = dir.lastIndexOf("node_modules/");
      dir = parent < 1 ? "" : dir.slice(0,parent - 1);
    }
    if (key) include(key);
    else if (!entry.optionalDependencies?.[name] && !entry.peerDependenciesMeta?.[name]?.optional) throw new Error("Missing dependency " + name);
  }
}
const dependencies = {};
for (const name of ALLOWED_RUNTIME_PACKAGES) {
  const path = "node_modules/" + name;
  include(path);
  dependencies[name] = lock.packages[path].version;
}
const manifest = {name:"itrader-stock-worker-linux",version:"1.0.0",private:true,type:"module",dependencies};
const runtimeLock = {name:manifest.name,version:manifest.version,lockfileVersion:3,requires:true,packages:{"":manifest,...packages}};
assertRuntimeLock(runtimeLock);
const hashes = {};
for (const source of ALLOWED_RUNTIME_SOURCES) {
  const bytes = readFileSync(resolve(repo,source));
  assertRuntimeSource(source,bytes.toString("utf8"));
  const dest = resolve(worker,source);
  mkdirSync(dirname(dest),{recursive:true}); writeFileSync(dest,bytes);
  hashes[source] = createHash("sha256").update(bytes).digest("hex");
}
for (const [name,data] of Object.entries({
  "package.json":manifest,"package-lock.json":runtimeLock,
  "tsconfig.json":{compilerOptions:{target:"ES2022",module:"ESNext",moduleResolution:"Bundler",baseUrl:".",paths:{"@/*":["./*"]},esModuleInterop:true,resolveJsonModule:true}},
})) writeFileSync(resolve(worker,name),JSON.stringify(data,null,2)+"\n");
verifyRuntimePayload(worker,hashes);
for (const [source,name] of [["oracle-controller.mjs","controller.mjs"],["itrader-stock-preview@.service","itrader-stock-preview@.service"],["itrader-stock-tmpfiles.conf","itrader-stock-tmpfiles.conf"]]) {
  copyFileSync(resolve(repo,"scripts/stock-update-desktop",source),resolve(out,name));
}
for (const name of [
  "oracle-runtime.mjs", "oracle-pairing-agent.mjs", "itrader-oracle-pairing@.service",
  "itrader-oracle-session@.service", "itrader-oracle-session@.path", "itrader-stock-production@.service",
  "itrader-oracle-production-pairing@.service", "itrader-oracle-production-session@.service", "itrader-oracle-production-session@.path",
]) {
  copyFileSync(resolve(repo, "scripts/stock-update-desktop", name), resolve(out, name));
}
console.log(out);

/** Build-time exporter. Never loads .env, connects to a database, or ships secrets. */
import { builtinModules, createRequire } from "node:module";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync, statSync, rmSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
function option(name, fallback) { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; }
const arch = option("--arch", "x64");
if (!new Set(["x64", "arm64"]).has(arch)) throw new Error("Choose x64 or arm64.");
const buildRoot = resolve(option("--out", resolve(repo, "private/stock-update-desktop-build")));
if (buildRoot === repo || !buildRoot.startsWith(resolve(repo, "private") + sep)) {
  throw new Error("Build output must be a dedicated directory beneath repository private/.");
}
const toolRoot = resolve(option("--tools", "D:/Tools/itrader-stock-update-build"));
const cache = resolve(toolRoot, "downloads");
const payload = resolve(buildRoot, "payload", arch);
const worker = resolve(payload, "worker");
const browserRoot = resolve(buildRoot, "browsers");
const NODE_VERSION = "v22.23.3";
const NODE_SHA256 = {
  x64: "2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71",
  arm64: "33dad22e4cef5ee8f9fbb1b0d037fdacd0e56d12a4580f0d63f68b894deab535",
};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + "\n"); };
for (const path of [cache, payload, worker, browserRoot, resolve(buildRoot, "logs"), resolve(toolRoot, "npm-cache"), resolve(toolRoot, "tmp")]) mkdirSync(path, { recursive: true });

const osKeys = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "SYSTEMDRIVE", "USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "PROGRAMDATA", "HOMEDRIVE", "HOMEPATH", "OS", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS"]);
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => osKeys.has(key.toUpperCase())));
Object.assign(childEnv, {
  TEMP: resolve(toolRoot, "tmp"), TMP: resolve(toolRoot, "tmp"),
  npm_config_cache: resolve(toolRoot, "npm-cache"), npm_config_registry: "https://registry.npmjs.org/",
  npm_config_audit: "false", npm_config_fund: "false", npm_config_update_notifier: "false",
  PLAYWRIGHT_BROWSERS_PATH: browserRoot, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
  DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused",
  CHECKPOINT_DISABLE: "1", PRISMA_GENERATE_SKIP_AUTOINSTALL: "1",
});
function run(exe, parameters, cwd, label, extraEnv = {}) {
  console.log(label);
  const result = spawnSync(exe, parameters, { cwd, env: { ...childEnv, ...extraEnv }, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  const log = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  writeFileSync(resolve(buildRoot, "logs", `${arch}-${label.replace(/[^a-zA-Z0-9-]/g, "-")}.log`), log);
  if (result.error || result.status !== 0) throw new Error(`${label} failed (${result.status ?? "spawn"}). ${log.slice(-1800)}`);
  return result.stdout;
}
async function nodeDistribution(target) {
  const name = `node-${NODE_VERSION}-win-${target}`;
  const zip = resolve(cache, `${name}.zip`);
  if (!existsSync(zip)) {
    const response = await fetch(`https://nodejs.org/dist/${NODE_VERSION}/${name}.zip`, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`Node ${target} download failed.`);
    writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
  }
  if (sha(readFileSync(zip)) !== NODE_SHA256[target]) throw new Error(`Node ${target} checksum mismatch.`);
  const home = resolve(cache, name);
  if (!existsSync(resolve(home, "node.exe"))) execFileSync("tar.exe", ["-xf", zip, "-C", cache], { windowsHide: true });
  return home;
}
const buildNodeHome = await nodeDistribution("x64");
const buildNode = resolve(buildNodeHome, "node.exe");
const npmCli = resolve(buildNodeHome, "node_modules/npm/bin/npm-cli.js");
const targetNodeHome = arch === "x64" ? buildNodeHome : await nodeDistribution(arch);
mkdirSync(resolve(payload, "runtime"), { recursive: true });
copyFileSync(resolve(targetNodeHome, "node.exe"), resolve(payload, "runtime/node.exe"));
copyFileSync(resolve(targetNodeHome, "LICENSE"), resolve(payload, "runtime/LICENSE.node.txt"));

const sourceFiles = new Set();
const packages = new Set(["tsx", "prisma", "@prisma/client", "sharp", "@playwright/test"]);
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));
function resolveLocal(specifier, from) {
  const base = specifier.startsWith("@/") ? resolve(repo, specifier.slice(2)) : resolve(dirname(from), specifier);
  const candidates = [base, ...[".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"].map((ext) => base + ext),
    ...["index.ts", "index.tsx", "index.js", "index.mjs"].map((name) => resolve(base, name))];
  if (/\.js$/.test(base)) candidates.push(base.slice(0, -3) + ".ts");
  const found = candidates.find((path) => existsSync(path) && statSync(path).isFile());
  if (!found || !found.startsWith(repo + sep) || found.includes(`${sep}private${sep}`) || found.includes(`${sep}node_modules${sep}`)) {
    throw new Error(`Unresolved/unsafe local dependency ${specifier} in ${relative(repo, from)}`);
  }
  return found;
}
function dependency(specifier, from) {
  if (specifier.startsWith("node:") || builtins.has(specifier)) return;
  if (specifier.startsWith(".") || specifier.startsWith("@/")) return trace(resolveLocal(specifier, from));
  packages.add(specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]);
}
function trace(path) {
  if (sourceFiles.has(path)) return;
  sourceFiles.add(path);
  if (!/\.[cm]?[jt]sx?$/.test(path)) return;
  const ast = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const onlyTypes = clause?.isTypeOnly || (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings) &&
        clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((entry) => entry.isTypeOnly));
      if (!onlyTypes) dependency(node.moduleSpecifier.text, path);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && !node.isTypeOnly) {
      const allType = node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every((entry) => entry.isTypeOnly);
      if (!allType) dependency(node.moduleSpecifier.text, path);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      if (!node.arguments[0] || !ts.isStringLiteralLike(node.arguments[0])) throw new Error(`Computed runtime import needs explicit review: ${relative(repo, path)}`);
      dependency(node.arguments[0].text, path);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
trace(resolve(repo, "scripts/dealer-stock-sync/desktop-worker.ts"));
const rootPackage = json(resolve(repo, "package.json"));
const rootLock = json(resolve(repo, "package-lock.json"));
const dependencies = {};
for (const name of [...packages].sort()) {
  const installed = json(resolve(repo, "node_modules", name, "package.json"));
  const pinned = rootLock.packages[`node_modules/${name}`]?.version;
  if (!pinned || installed.version !== pinned) throw new Error(`Installed dependency is not the locked revision: ${name}`);
  dependencies[name] = pinned;
}
const manifest = { name: "itrader-stock-worker-runtime", version: "1.0.0", private: true, type: "module", engines: { node: ">=22.12.0" }, dependencies, overrides: rootPackage.overrides };
const dependencyFingerprint = sha(Buffer.from(JSON.stringify({ manifest, arch, rootLock: sha(readFileSync(resolve(repo, "package-lock.json"))) })));
const marker = resolve(payload, ".dependency-fingerprint");
if (!existsSync(marker) || readFileSync(marker, "utf8") !== dependencyFingerprint || !existsSync(resolve(worker, "node_modules/tsx/package.json"))) {
  writeJson(resolve(worker, "package.json"), manifest);
  const seeded = structuredClone(rootLock);
  seeded.name = manifest.name; seeded.version = manifest.version;
  seeded.packages[""] = { name: manifest.name, version: manifest.version, dependencies, engines: manifest.engines };
  writeJson(resolve(worker, "package-lock.json"), seeded);
  run(buildNode, [npmCli, "install", "--package-lock-only", "--ignore-scripts", "--omit=dev", `--cpu=${arch}`, "--os=win32", "--no-audit", "--no-fund"], worker, "resolve-runtime-lock");
  run(buildNode, [npmCli, "ci", "--ignore-scripts", "--omit=dev", `--cpu=${arch}`, "--os=win32", "--no-audit", "--no-fund"], worker, "install-runtime-packages");
  writeFileSync(marker, dependencyFingerprint);
}
// Refresh only traced source files on subsequent builds; never copy the checkout.
for (const subtree of ["lib", "scripts", "data", "prisma", "app", "components"]) {
  rmSync(resolve(worker, subtree), { recursive: true, force: true });
}
const hashes = {};
for (const path of [...sourceFiles].sort()) {
  const rel = relative(repo, path);
  if (/(^|[\\/])(?:\.env(?:\..*)?|\.git|private|__tests__)([\\/]|$)/.test(rel)) throw new Error(`Forbidden source asset: ${rel}`);
  const destination = resolve(worker, rel); mkdirSync(dirname(destination), { recursive: true }); copyFileSync(path, destination);
  hashes[rel.split(sep).join("/")] = sha(readFileSync(path));
}
mkdirSync(resolve(worker, "prisma"), { recursive: true });
copyFileSync(resolve(repo, "prisma/schema.prisma"), resolve(worker, "prisma/schema.prisma"));
writeJson(resolve(worker, "tsconfig.json"), { compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", baseUrl: ".", paths: { "@/*": ["./*"] }, esModuleInterop: true, resolveJsonModule: true } });
writeFileSync(resolve(worker, "prisma-build.config.mjs"), 'export default { schema: "prisma/schema.prisma" };\n');
run(buildNode, [resolve(worker, "node_modules/prisma/build/index.js"), "generate", "--config", resolve(worker, "prisma-build.config.mjs")], worker, "generate-isolated-prisma-client");
if (arch === "x64") {
  run(buildNode, [resolve(worker, "node_modules/playwright/cli.js"), "install", "chromium"], worker, "bundle-matching-chromium", { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "0" });
  const smoke = `const w=await import('./scripts/dealer-stock-sync/desktop-worker.ts'); if(typeof w.runDesktop!=='function')throw Error('Entry export'); await import('./scripts/dealer-stock-sync/worker-cli.ts'); await import('./scripts/dealer-stock-sync/execute-job.ts'); await import('./scripts/dealer-stock-sync/pipeline.ts'); await import('./scripts/dealer-stock-sync/registry.ts'); const sharp=(await import('sharp')).default; await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>')).png().toBuffer(); const {chromium}=await import('@playwright/test'); const b=await chromium.launch({headless:true}); try{const p=await b.newPage();await p.setContent('<title>packaged worker</title>');if(await p.title()!=='packaged worker')throw Error('Browser');}finally{await b.close();} console.log('Standalone Node entry, sharp and Chromium passed; no database or website requests.');`;
  run(resolve(payload, "runtime/node.exe"), ["--import", "tsx", "--input-type=module", "-e", smoke], worker, "offline-runtime-smoke");
}
// node_modules packages retain their licence files; include a discoverable inventory.
const notices = [];
for (const [path, entry] of Object.entries(json(resolve(worker, "package-lock.json")).packages ?? {})) {
  if (path) notices.push({ packagePath: path, version: entry.version, license: entry.license ?? "See package licence files", integrity: entry.integrity });
}
writeJson(resolve(payload, "THIRD-PARTY-NOTICES.json"), notices);
let head = "unavailable";
try { head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8", windowsHide: true }).trim(); } catch { /* Explicit unknown, not fabricated revision. */ }
writeJson(resolve(payload, "runtime-manifest.json"), {
  version: "1.0.0", architecture: arch, nodeVersion: NODE_VERSION, nodeArchiveSha256: NODE_SHA256[arch],
  sourceHead: head, sourceFiles: hashes, sourceFingerprint: sha(Buffer.from(JSON.stringify(hashes))), dependencies,
  browser: { platform: "win64", playwright: dependencies["@playwright/test"], armHardwareVerified: false },
  credentialsIncluded: false, generatedAt: new Date().toISOString(),
});
console.log(JSON.stringify({ architecture: arch, payload, sourceFiles: sourceFiles.size, runtimePackages: packages.size, browserRoot }));

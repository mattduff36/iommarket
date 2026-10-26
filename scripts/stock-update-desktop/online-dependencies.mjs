/** Pins and checks the official archives setup downloads. No network and no .env. */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const NODE_VERSION = "v22.23.3";
export const NODE_ARCHIVES = {
  x64: {
    url: "https://nodejs.org/dist/v22.23.3/node-v22.23.3-win-x64.zip",
    sha256: "2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71",
    folder: "node-v22.23.3-win-x64",
    cacheName: "node-v22.23.3-win-x64.zip",
  },
  arm64: {
    url: "https://nodejs.org/dist/v22.23.3/node-v22.23.3-win-arm64.zip",
    sha256: "33dad22e4cef5ee8f9fbb1b0d037fdacd0e56d12a4580f0d63f68b894deab535",
    folder: "node-v22.23.3-win-arm64",
    cacheName: "node-v22.23.3-win-arm64.zip",
  },
};

export const PLAYWRIGHT_VERSION = "1.58.2";
export const BROWSER_ARCHIVES = {
  chromium: {
    name: "chromium", revision: "1208", directory: "chromium-1208",
    browserVersion: "145.0.7632.6",
    url: "https://cdn.playwright.dev/builds/cft/145.0.7632.6/win64/chrome-win64.zip",
    sha256: "08476e6fe550ccbc0d11d1ab030292fc4e32d4987400c77b2d1905a6bd13b4f6",
    cacheName: "chromium.zip", executable: "chrome-win64\\chrome.exe",
  },
  headless: {
    name: "chromium-headless-shell",
    revision: "1208",
    directory: "chromium_headless_shell-1208",
    browserVersion: "145.0.7632.6",
    url: "https://cdn.playwright.dev/builds/cft/145.0.7632.6/win64/chrome-headless-shell-win64.zip",
    sha256: "839500db9e1b0865961ce8b05134ba3d3d71b82be5dec236d6c87ecd93e082cd",
    cacheName: "headless.zip",
    executable: "chrome-headless-shell-win64\\chrome-headless-shell.exe",
  },
  ffmpeg: {
    name: "ffmpeg",
    revision: "1011",
    directory: "ffmpeg-1011",
    url: "https://cdn.playwright.dev/dbazure/download/playwright/builds/ffmpeg/1011/ffmpeg-win64.zip",
    sha256: "8d08827c019ad36e7b9d49d3648447d884534cb2acf200e71c715f6dd834cc50",
    cacheName: "ffmpeg.zip",
    executable: "ffmpeg-win64.exe",
  },
  winldd: {
    name: "winldd",
    revision: "1007",
    directory: "winldd-1007",
    url: "https://cdn.playwright.dev/dbazure/download/playwright/builds/winldd/1007/winldd-win64.zip",
    sha256: "0069f0d11d4ad6df068a068c003d22fe7dbec192a47bba64b2e115e9c8ce41d8",
    cacheName: "winldd.zip",
    executable: "PrintDeps.exe",
  },
};

const json = (path) => JSON.parse(readFileSync(path, "utf8"));

export function browserDirectory(name, revision) {
  return `${name.replaceAll("-", "_")}-${revision}`;
}

function problemList(problems) {
  if (problems.length > 0) throw new Error(problems.join("; "));
}

export function assertPinShape() {
  const downloads = [NODE_ARCHIVES.x64, NODE_ARCHIVES.arm64, ...Object.values(BROWSER_ARCHIVES)];
  const problems = [];
  for (const pin of downloads) {
    if (!pin.url.startsWith("https://") || pin.url.includes("latest")) problems.push(`Unpinned URL ${pin.url}`);
    if (!/^[a-f0-9]{64}$/.test(pin.sha256)) problems.push(`Missing hash for ${pin.url}`);
  }
  const hosts = downloads.map((pin) => new URL(pin.url).host);
  if (hosts.some((host) => host !== "nodejs.org" && host !== "cdn.playwright.dev")) problems.push("Unexpected download host");
  const headless = BROWSER_ARCHIVES.headless;
  if (browserDirectory(headless.name, headless.revision) !== headless.directory) problems.push("Headless directory drifted");
  if (!headless.url.includes(headless.browserVersion)) problems.push("Headless URL version drifted");
  problemList(problems);
}

export function assertBrowserCatalogue(catalogue, versions) {
  const problems = [];
  for (const [label, version] of Object.entries(versions)) {
    if (version !== PLAYWRIGHT_VERSION) problems.push(`${label} Playwright version drifted: ${version ?? "missing"}`);
  }
  const browsers = Array.isArray(catalogue?.browsers) ? catalogue.browsers : [];
  for (const pin of Object.values(BROWSER_ARCHIVES)) {
    const entry = browsers.find((browser) => browser.name === pin.name);
    if (!entry) {
      problems.push(`Built catalogue is missing ${pin.name}`);
      continue;
    }
    const directory = browserDirectory(pin.name, String(entry.revision));
    if (String(entry.revision) !== pin.revision || directory !== pin.directory) {
      problems.push(`${pin.name} directory drifted: ${directory}`);
    }
    if (pin.browserVersion && entry.browserVersion !== pin.browserVersion) {
      problems.push(`${pin.name} browser version drifted: ${entry.browserVersion ?? "missing"}`);
    }
    if (entry.revisionOverrides?.win64) problems.push(`${pin.name} gained a win64 revision override`);
  }
  problemList(problems);
}

export function assertPlaywrightMetadata(workerDir) {
  const worker = json(resolve(workerDir, "package.json"));
  const core = json(resolve(workerDir, "node_modules/playwright-core/package.json"));
  const test = json(resolve(workerDir, "node_modules/@playwright/test/package.json"));
  const catalogue = json(resolve(workerDir, "node_modules/playwright-core/browsers.json"));
  assertBrowserCatalogue(catalogue, {
    worker: worker.dependencies?.["@playwright/test"],
    core: core.version,
    test: test.version,
  });
}

function sha256File(path) {
  return new Promise((done, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => done(hash.digest("hex")));
  });
}

export function cachedArchives(toolRoot) {
  const downloads = resolve(toolRoot, "downloads");
  const online = resolve(downloads, "online-installer");
  return [
    { label: "node-x64", path: resolve(downloads, NODE_ARCHIVES.x64.cacheName), sha256: NODE_ARCHIVES.x64.sha256 },
    { label: "node-arm64", path: resolve(downloads, NODE_ARCHIVES.arm64.cacheName), sha256: NODE_ARCHIVES.arm64.sha256 },
    { label: "chromium", path: resolve(online, BROWSER_ARCHIVES.chromium.cacheName), sha256: BROWSER_ARCHIVES.chromium.sha256 },
    { label: "headless", path: resolve(online, BROWSER_ARCHIVES.headless.cacheName), sha256: BROWSER_ARCHIVES.headless.sha256 },
    { label: "ffmpeg", path: resolve(online, BROWSER_ARCHIVES.ffmpeg.cacheName), sha256: BROWSER_ARCHIVES.ffmpeg.sha256 },
    { label: "winldd", path: resolve(online, BROWSER_ARCHIVES.winldd.cacheName), sha256: BROWSER_ARCHIVES.winldd.sha256 },
  ];
}

export async function assertCachedArchives(toolRoot) {
  for (const archive of cachedArchives(toolRoot)) {
    if (!existsSync(archive.path)) throw new Error(`Missing pinned download ${archive.label}: ${archive.path}`);
    const digest = await sha256File(archive.path);
    if (digest !== archive.sha256) throw new Error(`Checksum mismatch for ${archive.label}`);
  }
}

function define(name, value) {
  if (!/^[A-Za-z0-9]+$/.test(name) || /["\r\n{}#]/.test(value)) throw new Error(`Unsafe Inno define ${name}`);
  return `#define ${name} "${value}"`;
}

export function renderInnoInclude() {
  assertPinShape();
  const headless = BROWSER_ARCHIVES.headless;
  const ffmpeg = BROWSER_ARCHIVES.ffmpeg;
  const winldd = BROWSER_ARCHIVES.winldd;
  return [
    "; Generated from scripts/stock-update-desktop/online-dependencies.mjs. Do not edit.",
    define("OnlineNodeX64Url", NODE_ARCHIVES.x64.url),
    define("OnlineNodeX64Sha", NODE_ARCHIVES.x64.sha256),
    define("OnlineNodeFolderX64", NODE_ARCHIVES.x64.folder),
    define("OnlineNodeArm64Url", NODE_ARCHIVES.arm64.url),
    define("OnlineNodeArm64Sha", NODE_ARCHIVES.arm64.sha256),
    define("OnlineNodeFolderArm64", NODE_ARCHIVES.arm64.folder),
    define("OnlineChromiumUrl", BROWSER_ARCHIVES.chromium.url),
    define("OnlineChromiumSha", BROWSER_ARCHIVES.chromium.sha256),
    define("OnlineChromiumDir", BROWSER_ARCHIVES.chromium.directory),
    define("OnlineChromiumExe", BROWSER_ARCHIVES.chromium.executable),
    define("OnlineHeadlessUrl", headless.url),
    define("OnlineHeadlessSha", headless.sha256),
    define("OnlineHeadlessDir", headless.directory),
    define("OnlineHeadlessExe", headless.executable),
    define("OnlineFfmpegUrl", ffmpeg.url),
    define("OnlineFfmpegSha", ffmpeg.sha256),
    define("OnlineFfmpegDir", ffmpeg.directory),
    define("OnlineFfmpegExe", ffmpeg.executable),
    define("OnlineWinlddUrl", winldd.url),
    define("OnlineWinlddSha", winldd.sha256),
    define("OnlineWinlddDir", winldd.directory),
    define("OnlineWinlddExe", winldd.executable),
    "",
  ].join("\r\n");
}

export function writeInnoInclude(buildRoot) {
  const destination = resolve(buildRoot, "online-dependencies.iss");
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, renderInnoInclude());
  return destination;
}

function option(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? "" : args[index + 1] ?? "";
}

async function main() {
  const args = process.argv.slice(2);
  const toolRoot = option(args, "--tools") || "D:/Tools/itrader-stock-update-build";
  const buildRoot = option(args, "--out");
  if (!buildRoot) throw new Error("--out is required");
  const worker = option(args, "--worker") || resolve(buildRoot, "payload/x64/worker");
  assertPinShape();
  assertPlaywrightMetadata(worker);
  await assertCachedArchives(toolRoot);
  writeInnoInclude(buildRoot);
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Online dependency check failed."}\n`);
    process.exitCode = 1;
  });
}

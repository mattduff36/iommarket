/* @vitest-environment node */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BROWSER_ARCHIVES,
  NODE_ARCHIVES,
  PLAYWRIGHT_VERSION,
  assertBrowserCatalogue,
  assertCachedArchives,
  assertPlaywrightMetadata,
  browserDirectory,
  renderInnoInclude,
} from "@/scripts/stock-update-desktop/online-dependencies.mjs";

const repo = resolve(import.meta.dirname, "../..");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function temp() {
  const root = mkdtempSync(join(tmpdir(), "stock-online-installer-"));
  roots.push(root);
  return root;
}
function put(root: string, name: string, value: string) {
  const path = join(root, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}
function catalogue() {
  return JSON.parse(readFileSync(resolve(repo, "node_modules/playwright-core/browsers.json"), "utf8")) as {
    browsers: Array<{ name: string; revision: string; browserVersion?: string; revisionOverrides?: Record<string, string> }>;
  };
}
function versions() {
  const core = JSON.parse(readFileSync(resolve(repo, "node_modules/playwright-core/package.json"), "utf8")).version as string;
  const test = JSON.parse(readFileSync(resolve(repo, "node_modules/@playwright/test/package.json"), "utf8")).version as string;
  return { worker: test, core, test };
}
function workerFixture(mutate?: (files: { worker: { dependencies: Record<string, string> }; catalogue: ReturnType<typeof catalogue> }) => void) {
  const root = temp();
  const files = {
    worker: { dependencies: { "@playwright/test": PLAYWRIGHT_VERSION } },
    catalogue: catalogue(),
  };
  mutate?.(files);
  put(root, "package.json", JSON.stringify(files.worker));
  put(root, "node_modules/playwright-core/package.json", JSON.stringify({ version: versions().core }));
  put(root, "node_modules/@playwright/test/package.json", JSON.stringify({ version: versions().test }));
  put(root, "node_modules/playwright-core/browsers.json", JSON.stringify(files.catalogue));
  return root;
}
function functionBody(source: string, name: string) {
  const start = source.indexOf(`function ${name}`);
  const next = source.indexOf("\nfunction ", start + 1);
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, next === -1 ? source.length : next);
}

describe("online installer pins", () => {
  it("pins both browser modes required by the dealer registry", () => {
    const exporter = readFileSync(resolve(repo, "scripts/stock-update-desktop/package-runtime.mjs"), "utf8");
    expect(exporter).toContain(NODE_ARCHIVES.x64.sha256);
    expect(exporter).toContain(NODE_ARCHIVES.arm64.sha256);
    expect(NODE_ARCHIVES.x64.url).toBe("https://nodejs.org/dist/v22.23.3/node-v22.23.3-win-x64.zip");
    expect(BROWSER_ARCHIVES.headless.sha256).toBe("839500db9e1b0865961ce8b05134ba3d3d71b82be5dec236d6c87ecd93e082cd");
    expect(BROWSER_ARCHIVES.ffmpeg.sha256).toBe("8d08827c019ad36e7b9d49d3648447d884534cb2acf200e71c715f6dd834cc50");
    expect(BROWSER_ARCHIVES.winldd.sha256).toBe("0069f0d11d4ad6df068a068c003d22fe7dbec192a47bba64b2e115e9c8ce41d8");
    expect(BROWSER_ARCHIVES.headless.url).toBe("https://cdn.playwright.dev/builds/cft/145.0.7632.6/win64/chrome-headless-shell-win64.zip");
    const rendered = renderInnoInclude();
    expect(rendered).toContain(BROWSER_ARCHIVES.winldd.url);
    expect(rendered).toContain(BROWSER_ARCHIVES.chromium.url);
    expect(rendered).toContain(BROWSER_ARCHIVES.chromium.sha256);
    expect(rendered).not.toContain("latest");
  });

  it("accepts the built Playwright catalogue and rejects a directory change", () => {
    expect(browserDirectory("chromium-headless-shell", "1208")).toBe("chromium_headless_shell-1208");
    expect(() => assertBrowserCatalogue(catalogue(), versions())).not.toThrow();
    expect(() => assertPlaywrightMetadata(workerFixture())).not.toThrow();
    const drifted = catalogue();
    const headless = drifted.browsers.find((browser) => browser.name === "chromium-headless-shell");
    expect(headless).toBeTruthy();
    headless!.revision = "9999";
    expect(() => assertBrowserCatalogue(drifted, versions())).toThrow(/directory drifted: chromium_headless_shell-9999/);
    expect(() => assertPlaywrightMetadata(workerFixture((files) => { files.worker.dependencies["@playwright/test"] = "9.9.9"; }))).toThrow(/version drifted/);
  });

  it("rejects a missing archive and a hash that does not match the pin", async () => {
    const missing = temp();
    await expect(assertCachedArchives(missing)).rejects.toThrow(/Missing pinned download node-x64/);
    const wrong = temp();
    for (const name of ["node-v22.23.3-win-x64.zip", "node-v22.23.3-win-arm64.zip"]) put(wrong, join("downloads", name), "not-the-archive");
    for (const name of ["headless.zip", "ffmpeg.zip", "winldd.zip"]) put(wrong, join("downloads", "online-installer", name), "not-the-archive");
    await expect(assertCachedArchives(wrong)).rejects.toThrow(/Checksum mismatch for node-x64/);
  });

  it("keeps download, hash and extraction ahead of any existing-app deletion", () => {
    const iss = readFileSync(resolve(repo, "desktop/StockUpdate/installer.iss"), "utf8");
    const stage = functionBody(iss, "StageExtractedDirectory");
    const download = functionBody(iss, "DownloadAndStageDependencies");
    const prepare = functionBody(iss, "PrepareToInstall");
    expect(iss).toContain('AddBackslash(BuildRoot) + "online-dependencies.iss"');
    expect(iss).toContain("#include OnlineInclude");
    expect(iss).toContain("ArchiveExtraction=full");
    expect(iss).toContain("CreateDownloadPage");
    expect(iss).not.toContain("Shell.Application");
    expect(iss).not.toContain("NextButtonClick");
    expect(iss).not.toContain("CurStepChanged");
    expect(iss).toContain("{#OnlineChromiumUrl}");
    expect(iss).toContain("{#OnlineChromiumExe}");
    expect(iss).not.toContain("{#BuildRoot}\\browsers\\");
    expect(iss).toContain("runtime\\*");
    expect(iss).toContain("{tmp}\\online-runtime\\node.exe");
    expect(iss).toContain("{tmp}\\online-runtime\\LICENSE.node.txt");
    expect(iss).toContain("AppMutex=Local\\iTrader.StockUpdate.SingleInstance");
    expect(iss).toContain('Type: filesandordirs; Name: "{localappdata}\\iTrader\\StockUpdate"');
    expect(prepare).toContain("DownloadAndStageDependencies");
    expect(prepare).toContain("before [InstallDelete]");
    expect(prepare).not.toMatch(/filesandordirs|DeleteFile|DelTree/);
    expect(download.indexOf("DownloadPage.Add")).toBeLessThan(download.indexOf("DownloadPage.Download"));
    expect(download.indexOf("DownloadPage.Download")).toBeLessThan(download.indexOf("ExtractArchive"));
    expect(download.indexOf("FileExists")).toBeGreaterThan(download.indexOf("ExtractArchive"));
    expect(download.indexOf("StageExtractedDirectory")).toBeGreaterThan(download.indexOf("FileExists"));
    expect(download).toContain("AbortedByUser");
    expect(stage.indexOf("ExtractArchive")).toBeLessThan(stage.indexOf("FileExists"));
    expect(stage.indexOf("FileExists")).toBeLessThan(stage.indexOf("INSTALLATION_COMPLETE"));
    const deletion = iss.slice(iss.indexOf("[InstallDelete]"), iss.indexOf("[Files]"));
    expect(deletion).toContain("{app}\\browsers");
    expect(deletion).not.toContain("Download");
    expect(deletion).not.toContain("ExtractArchive");
  });
});

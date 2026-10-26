# Stock Update online installer dependencies

The private installer still carries the self-contained application and the reviewed worker, including its npm packages. It does not carry the Node runtime or the Playwright browser tree. Setup downloads those from fixed official HTTPS URLs. The build-time exporter in `scripts/stock-update-desktop/package-runtime.mjs` is unchanged and still writes the full runtime and browser payload for audit and the offline build-host smoke test.

An internet connection is required while the installer runs. Git, npm and a separate .NET installation are not required on the client. The installer stays unsigned. The single-instance mutex, per-user install, session directory and uninstall behaviour are unchanged. Encrypted sessions remain in `{localappdata}\iTrader\StockUpdate`.

## Pinned downloads

`scripts/stock-update-desktop/online-dependencies.mjs` holds the pins. Node is v22.23.3, the same archives and SHA256 values as the exporter. The browser pins are the win64 Chromium, headless shell, FFmpeg and Winldd for Playwright 1.58.2:

| Component | Archive | Directory |
| --- | --- | --- |
| Node x64 or ARM64 | `https://nodejs.org/dist/v22.23.3/node-v22.23.3-win-<arch>.zip` | `{app}\runtime\node.exe` and `LICENSE.node.txt` only |
| Chromium 145.0.7632.6 | `https://cdn.playwright.dev/builds/cft/145.0.7632.6/win64/chrome-win64.zip` | `{app}\browsers\chromium-1208` |
| Headless shell 145.0.7632.6 | `https://cdn.playwright.dev/builds/cft/145.0.7632.6/win64/chrome-headless-shell-win64.zip` | `{app}\browsers\chromium_headless_shell-1208` |
| FFmpeg 1011 | `https://cdn.playwright.dev/dbazure/download/playwright/builds/ffmpeg/1011/ffmpeg-win64.zip` | `{app}\browsers\ffmpeg-1011` |
| Winldd 1007 | `https://cdn.playwright.dev/dbazure/download/playwright/builds/winldd/1007/winldd-win64.zip` | `{app}\browsers\winldd-1007` |

There is no `latest` URL. Both browser modes are downloaded because sources such as Mike's Motors explicitly require headed Chromium. ARM Windows downloads the ARM64 Node zip and the same win64 browser archives. Each browser directory receives an empty `INSTALLATION_COMPLETE` marker after extraction.

Before Inno Setup compiles, the script reads the built x64 worker's `@playwright/test`, `playwright-core` and `browsers.json`. It fails if the Playwright version or the four browser directories differ from these pins. It also hashes the cached zips under `D:\Tools\itrader-stock-update-build\downloads` (Node) and `downloads\online-installer` (chromium, headless, ffmpeg, winldd). A missing file or a different hash stops the build. The script does not download anything.

## Installer order

`PrepareToInstall` runs for both interactive and silent setup, before `[InstallDelete]`. It uses `CreateDownloadPage` so the operator can see progress and cancel. Inno checks the pinned SHA256 while downloading into `{tmp}`. Only after that check does `ExtractArchive` run, with `ArchiveExtraction=full`. The script then requires `node.exe`, `chrome.exe`, `chrome-headless-shell.exe`, `ffmpeg-win64.exe` and `PrintDeps.exe`. External `[Files]` entries copy the staged Node files and browser directories into `{app}`.

A download error, hash mismatch, extraction error, missing executable or cancellation returns an error from `PrepareToInstall`. Setup stops and the previous installation remains in place. The client does not run npm or extract through `Shell.Application`.

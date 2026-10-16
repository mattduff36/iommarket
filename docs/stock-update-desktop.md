# iTrader Stock Update for Windows

## Scope and security boundary

A manually started, per-user Windows 11 desktop application runs the existing dealer stock worker. The installer includes both Preview (`https://itrader.dev`) and Production (`https://itrader.im`), a private Node.js runtime, the generated Prisma client, required runtime dependencies and the Playwright-matched browser. The client does not need Git, repository access, npm, Cursor or a separate .NET installation.

There is no service, Windows startup task, scheduled scrape, automatic approval, database migration or automatic production enablement. Already queued eligible jobs in the selected environment can be processed while Start is active. The computer must stay awake and online. Safe stop drains the current job before exit; it does not cancel an approved apply transaction midway.

This is a trusted-computer architecture: the running worker has dedicated direct database and ImageKit credentials. Windows DPAPI CurrentUser encrypts the stored device session. Worker configuration is retrieved over authenticated HTTPS, remains in memory, and is passed to the bundled process over its stdin pipe, not command-line arguments, log files or a plaintext configuration file. A user with sufficient access to the running process can still extract credentials. Account/device revocation prevents further work by the supported app; it does not invalidate an extracted database password or ImageKit key. Revoke/rotate those underlying credentials following loss or compromise.

## Browser authorisation

The app creates a random verifier and S256 challenge, requests a ten-minute pairing, and opens the system browser at the selected canonical iTrader origin. The signed-in administrator must explicitly approve the named computer and environment. A GET never approves a pairing. No user password is collected by the desktop application.

The API at `POST /api/stock-worker` accepts `begin`, `poll`, `session` and `revoke` operations. It returns no-store JSON. An opaque device token, sent only in the Authorization header, lasts 30 days. Expiry requires a new browser pairing. Redis holds hashed codes/tokens in separate preview/production namespaces and uses atomic claims so a pairing cannot issue two sessions. Redis failures or lost state fail closed. There is no in-memory fallback in the live service.

Each session check revalidates the current internal user: role ADMIN, not disabled/deleted, and explicitly allowlisted. The worker performs a fresh online check before leasing another job. The staging proxy permits only the exact POST API path without a server action to reach this independently authenticated endpoint. No broad API/page exemption is added.

## Server provisioning — never included in the installer

The existing server must be released with the new endpoint/page and configured independently in each environment. Do not put production values in Preview.

- `DEALER_STOCK_DESKTOP_ENABLED=1` enables this dedicated endpoint.
- `DEALER_STOCK_DESKTOP_ALLOWED_ADMIN_IDS` contains one or two comma-separated **internal User IDs** for the approved Matt/Dave admin accounts. Resolve them from the correct environment; do not guess IDs or substitute the existing broader staging-email allowlist.
- `DEALER_STOCK_DESKTOP_CONFIG_JSON` is an object mapping exactly those admin IDs to separately provisioned, reviewed worker configuration. The endpoint must not fall back to the website's broad environment variables.
- The existing Upstash REST URL and token must be configured. Namespaces are `itrader:stock-desktop:preview` and `itrader:stock-desktop:production`. TTL state loss requires sign-in again; it does not alter stock.
- Existing stock-update environment, schema, ImageKit and production activation gates remain enforced. This feature adds no SQL schema migration and does not activate existing stock tables/features automatically.

Allowed worker keys are the ones explicitly listed in `desktop-config.ts` / `desktop-worker.ts`: environment/worker flags, canonical app and Supabase origins, one or more matching database URLs, the verified database CA, and the existing ImageKit media settings. Unknown executable/environment injection keys such as `NODE_OPTIONS`, `PATH` or TLS-disable flags are rejected. Preview image uploads require its existing explicit staging identity. A database URL's existence is not proof its permissions are sufficiently restricted: provision and test the minimum permissions on the required tables/functions before client acceptance.

Never email credentials, embed them in the installer, copy the general `.env.local`, expose provider secrets to browser HTML, or provision credentials through an unreviewed live action. Administrative device revocation is at `/admin/stock-worker`. Website sign-out and desktop-session sign-out are deliberately distinct.

## Build

Run `scripts/stock-update-desktop/build.ps1` on the authorised Windows build host. Defaults use private SDK/compiler caches under `D:\Tools\itrader-stock-update-build`; no system PATH change is required. Outputs go beneath `private/stock-update-desktop-build`.

Pinned runtime: Node v22.23.3, using the official x64/ARM64 archive hashes in the exporter. Playwright/browser and other runtime versions derive from the repository's installed, locked packages. The exporter walks concrete runtime imports (including literal dynamic imports and `@/` aliases), emits only the necessary local source closure, generates a private runtime lock, installs the matching architecture-specific dependencies and generates Prisma in that isolated payload. It never reads `.env`, copies `.git`/private files, or connects to a database while building. Generated payload manifests identify source hashes and dependency versions; third-party package licence files remain included.

The .NET 10 app is published self-contained for win-x64 and win-arm64. The single Inno installer selects the OS architecture and includes a matching private Node runtime. The Playwright Windows browser is currently win64; on ARM that browser path relies on Windows x64 emulation and still requires hardware acceptance. Compilation for ARM does not establish successful execution there.

The installer refuses Windows versions before Windows 11, installs without elevation, creates Start-menu/optional desktop shortcuts, and checks the application's named mutex before installation/uninstallation. It neither force-closes an active worker nor adds a startup registration. Upgrades preserve encrypted sessions stored outside the install directory. Uninstall removes only this user's app-owned session/cache directory; it is not server-side revocation.

A publisher certificate is not automatically acquired or fabricated. Without a real signing certificate, the produced EXE is an **unsigned test build**. Signing must be completed by the release owner before normal client distribution; signing itself does not guarantee the absence of SmartScreen warnings. Never disable Windows security to make installation work.

## Verification and acceptance

Local automated tests cover account/configuration restrictions, pairing replay, bad PKCE, expiration/revocation, exact machine-route handling, bounded messages, fail-closed worker authorisation, safe stop, native DTO/DPAPI handling and the private Node/browser/image runtime. A Redis adapter contract test is not a hosted Redis/Lua execution test. See actual build logs and review receipts for commands, candidate hashes and results.

Before handing the application to Dave as ready to use, demonstrate installation on a clean Windows 11 account without development tools; launch/check/close and upgrade/uninstall; browser sign-in against the deployed Preview endpoint; explicit Preview scrape, report review and approval; owned photos and final stock result; expired/revoked access and interrupted connectivity; and physical ARM execution if that architecture is required. Production needs its separately reviewed deployment/configuration and supervised acceptance. Do not treat compilation, offline tests or a generic 'finished processing' event as proof those gates passed.

Check connection is non-mutating: it validates the app session, makes a read-only stock-table access probe, opens the bundled browser on local HTML and exercises native image processing. It never queues, leases, approves, applies or uploads stock. ImageKit upload credentials and database write permissions are proven only by the supervised end-to-end test, not by the read-only check.

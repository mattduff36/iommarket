# iTrader Stock Update for Windows 1.1.0

## Scope and security boundary

This unsigned application is for the agreed private internal use by Matt and the client. Preview and Production are supported through separate authorised sessions and update channels. The existing explicit Preview/Production selector and server production gates remain; production activation was authorised on 26 October 2026. Signing is out of scope.

The Windows application runs Chromium scraping locally. It receives only an environment-scoped, revocable device session token. The server retains database credentials, ImageKit private keys, report generation, approvals, database writes and all media operations. Neither installation nor authorisation sends database/provider credentials or general server configuration to the computer.

The installer includes the native app and the reviewed scraping source closure with its Sharp and Playwright packages. During setup it downloads the matching official Node.js runtime and the pinned Playwright headless shell, FFmpeg and Winldd archives. Setup downloads both Chromium modes needed by the configured dealer websites. An internet connection is required for installation. The private build still exports the complete runtime and browser tree for audit and the offline build-host smoke test; that copy is not what the installer ships. It does not include Prisma, PostgreSQL clients, server media modules, repository access, configuration secrets or saved sessions. Git, npm, Cursor, a separate .NET installation and development tools are not required on the client. See docs/stock-update-online-installer.md.

The app starts work only when the operator clicks Start worker on Stock Reviews. There is no service, startup registration, scheduled scrape or automatic approval. Eligible queued work in the explicitly selected environment can be processed while the worker runs. The computer must remain awake and connected. Stop safely finishes the current job and takes no next job; it does not cancel a server apply halfway through.

## Authorisation and jobs

Browser pairing uses a random verifier with S256 and an expiring, single-use claim. A signed-in, allowlisted administrator explicitly approves the named device and environment. The app does not collect the user's password. Windows DPAPI CurrentUser encrypts the saved session, and the bearer token is passed to the child only over stdin.

The pairing route is POST /api/stock-worker. Session responses contain only the session/account fields; includeConfig:true is rejected. Each authenticated request rechecks the administrator's current role, enabled status, allowlist and environment. Redis stores hashed tokens/codes in separate Preview and Production namespaces; live Redis failure fails closed. Session expiry requires pairing again.

POST /api/stock-worker/jobs supports check, lease, heartbeat, submit, fail and step. It has strict JSON/UTF-8 and 2 MiB request limits, no query credentials, no-store responses, a per-device limit of 60 requests per minute, and fresh session/environment authorisation on every operation. The client uses only the fixed canonical HTTPS endpoint, rejects redirects, bounds response size and time, and does not retry ambiguous mutations.

Leases last 15 minutes and are bound to environment, administrator, device and a random lease token. A unique busy-owner compare-and-set fences each submit/fail/step. Expired, foreign and replayed leases cannot mutate the job. Local scraping sends a heartbeat every 60 seconds; apply steps authorise separately and do not run a competing heartbeat.

The server selects the trusted registry key. The client submits raw source results and timestamps only, within 2,000 vehicles and 20 candidate image URLs per vehicle. The server validates the exact configured sources, source/photo hosts and completeness, then rebuilds reconciliation, the review plan and its fingerprint. Missing completeness, missing usable photos and partial inventories remain blocking safeguards. The client cannot supply a plan, approval, report fingerprint or arbitrary image host.

Stock Reviews remains the approval interface. APPLY validates the stored approved report, binding, dealer, active approver and approved fingerprint; the actual enqueue payload contains only reportId and fingerprint. Each step stages at most one approved source photo, with strict public-address DNS pinning, redirect rejection, byte/time limits, raster validation and managed ownership/cleanup receipts. Server-only progress is tied to the job/report/action/photo index and server-generated upload attempt.

After all required photos are staged, the server revalidates approval and fingerprint and atomically applies the entire frozen report together with the ownership receipt claims. It never commits one vehicle at a time. Lost lease ownership cannot delete photos now needed by another executor. Ambiguous/crashed work retains managed cleanup receipts for recovery. The client reports applied success only after an actual successful terminal server result.

Ordinary requests have a 60-second deadline; photo steps have a 240-second deadline under the 300-second route limit. If the response is lost after the server acts, the worker stops and directs the operator to Stock Reviews. Inspect the actual report/job state before restarting or queuing again.

## Staging configuration and legacy credential retirement

Configure only the Preview target scoped to the staging branch. Do not copy Preview values to Production.

- DEALER_STOCK_DESKTOP_ENABLED=1 and the existing explicit internal administrator allowlist remain required.
- DEALER_STOCK_DESKTOP_API_ONLY=1 selects the credential-free jobs path. The new path does not read DEALER_STOCK_DESKTOP_CONFIG_JSON; remove that obsolete staging value after the complete new path is ready.
- Existing server/database identity, canonical origin, Redis and stock-update environment checks remain in force. Production requires its separate explicit activation.
- Server-side media uses the website's reviewed media configuration and managed ownership system. No new desktop provider credential is issued.
- No schema migration or new database grant is needed.

Removing an environment variable does not remove secrets retained by earlier deployments. After proving the new API workflow and confirming there are no active jobs, disable LOGIN on the exact obsolete staging role itrader_stock_worker and verify the result. Inspect/terminate only any surviving sessions of that obsolete role.

Retire the old desktop ImageKit key only after verifying its provider identity and that it is dedicated, distinct from the website's shared key. If that identity cannot be established, stop that operation and obtain the narrow missing information. Never revoke a shared website key or touch production credentials. Do not rerun the old provisioning --apply command as rotation; it reuses saved credentials. Never decrypt provisioning recovery files into logs or distribute them.

Device revocation is available at /admin/stock-worker. Revoking this new app's token prevents further authorised API operations; no database/provider credentials are present on the new client to rotate.

## Operator instructions

1. Install and open iTrader Stock Update. Select the intended Preview or Production environment.
2. Click Sign in, use the existing administrator account in the browser, and approve the named computer for Preview.
3. Keep the app open and wait for Stock Reviews to show Connected. Signing in does not start jobs. Debug layout retains the read-only Check connection diagnostic.
4. Open Stock Reviews and queue the intended dealer scan. Click Start worker on Stock Reviews and keep the computer awake and online.
5. Review the resulting report, all proposed changes and source photos on the website. Resolve incomplete scans or missing photos. Approve only the report intended for application.
6. After approving the report, click Start worker again. The worker stops automatically when no queued jobs remain. Server steps stage the approved photos and apply the entire report. Verify the report outcome and listings in Stock Reviews.
7. Click Stop safely and wait for it to stop before closing.

Use Sign out or Manage devices to revoke a device that should no longer have access. An interrupted connection can leave a completed server operation without a received client response; inspect Stock Reviews before trying again.

## Building and payload verification

Run scripts/stock-update-desktop/build.ps1 on the authorised Windows build host after the required repository gates have committed the release. The default private output is private/stock-update-release-1.1.0; tool caches remain under D:\Tools\itrader-stock-update-build. Earlier 1.0.0 and 1.0.1 installers must be preserved.

A final installer requires a clean, committed checkout. The runtime manifests must identify that same source commit, the correct version/architecture and an unmodified export. Native binaries are always published afresh from that checkout, version-checked and followed by the offline self-test. The build rechecks source provenance before and after installer compilation and writes the installer SHA256 and release manifest. The standalone package-runtime.mjs exporter can run on dirty development source, but records sourceDirty:true and cannot supply a final installer build.

Node v22.23.3 comes from the pinned official x64/ARM64 ZIP checksums. Each export freshly extracts the verified archive before using or copying Node, and records the executable hash. The exporter traces concrete runtime imports, rejects computed/unreviewed imports and server packages, and permits only the reviewed scraping sources plus tsx, Sharp and Playwright as direct dependencies. The generated runtime lock is derived from installed repository-locked versions.

Each architecture payload is rebuilt cleanly. The exporter checks actual copied source hashes and rejects forbidden private/session/environment files and links, including outside the worker directory. The build repeats payload checks after native publishing. Builds do not load .env, connect to the database or perform website/media operations. The x64 smoke check uses local HTML and generated image data. Third-party package licence files and a dependency inventory are included.

The self-contained .NET 10 app and private Node payload are produced for win-x64 and win-arm64. The single installer detects the architecture. The Playwright browser is win64, so ARM relies on Windows x64 emulation and requires separate physical hardware testing. An ARM cross-build does not prove ARM execution. This release's required execution acceptance is x64.

The installer requires Windows 11, installs per user without elevation and creates Start-menu/optional desktop shortcuts. The existing named mutex prevents installation over a running app. Setup downloads and verifies the pinned archives before it removes old app-owned worker, runtime or browser directories, including a silent install. A failed download, checksum, extraction or cancellation stops setup and leaves the previous installation in place. Encrypted sessions outside the installation directory are preserved during upgrade. Uninstall removes the user's local app data but does not revoke the server-side session.

## Acceptance evidence and limits

The repository tests cover credential-free responses, strict authentication and inventory boundaries, actual APPLY enqueue payloads, route/integration behavior, device-bound leases, concurrent/replayed/expired mutations, DNS/private-address/redirect/time limits, staged-photo cleanup races, atomic receipt/listing commits, token-only HTTP/bootstrap handling, safe stop and ambiguous failures. Native offline tests cover session DTOs, DPAPI, bounded strict parsing, child bootstrap/environment isolation, late cancellation and fixed status messages.

These automated results establish only their tested scope. Hosted acceptance must separately demonstrate the exact staging deployment, new app sign-in/check, real scrape → review/approval → photo staging → atomic apply, owned photos/receipts/audits, and a repeat scan without repeated changes. Never approve a zero-action plan or bypass missing-photo/incomplete-scrape safeguards to force a pass. A labelled isolated staging fixture requires its scope to be reviewed first if no genuine eligible listing remains.

Development-PC installer acceptance must include upgrade/fresh installation, second launch, safe stop, controlled network failure and uninstall cleanup, preserving any encrypted owner session safely. The Surface installation is deliberately retained for the owner's manual tests; do not uninstall, reset or reboot it without permission. Historical Surface 1.0.1 evidence is not evidence for this redesign. Report unavailable device access, authentication, hardware tests or reboot tests honestly.

Signing is explicitly out of scope for this private release. Do not disable Windows security to work around an installer block. Production activation remains separately authorised work.

## Version 1.1.3

The default Windows view contains Sign in / Open Stock Reviews and Stop safely when running. The View menu exposes Debug layout, off at every launch, with the previous controls and diagnostics. A saved Preview session reconnects presence only; it never starts job processing automatically. Sign in opens Stock Reviews for explicit computer approval.

Stock Reviews polls presence and refreshes saved results every five seconds while visible, deferring refresh during edits or dialogs. Dealer selections remain local. Its sticky iTrader bar shows connection, current job, elapsed time, and bounded safe activity. Website Start and Stop commands are tied to a short-lived connected instance. Network failure safely stops the worker and requires explicit reconnection; it never silently restarts. No database or storage credentials are sent to the app.

The online unsigned installer downloads pinned, SHA-256-verified Node and headless Chromium dependencies before changing an existing installation. Internet access is required. Staging dealer choices exclude demo, disabled and deleted accounts; unavailable profiles have a visible explanation. Weekly scheduling is unchanged.

The worker drains the queue and stops automatically. Start is blue and Stop safely is red. Stock Reviews announces new task completion in a persistent dialog, including failed outcomes, and shows explicit finished status.

## Version 1.1.8 production rollout

Every app launch, including after an update, defaults to Preview. The bottom-right Switch to production site button requires a warning confirmation (No is the default); switching is disabled during sign-in or work. There is no direct radio-selector bypass. Returning to Preview does not need confirmation. This policy remains until the owner explicitly changes it.

App-requested updates retain the install directory, shortcut settings and encrypted sessions, run without setup questions or a reboot, and reopen on Preview after success. Preview and Production validate separately signed release channels and exact environment storage hosts. The server retains all database and media credentials.

The dealer picker and dashboard use current paid or complimentary Pro entitlement; Starter and expired/unentitled accounts appear under Unavailable dealers. This frontend selection policy does not rewrite historical reports or dealer subscriptions.

## Version 1.1.9 stock-review quality

Recognised dealer placeholder image URLs are replaced with iTrader's existing brand placeholder artwork before managed upload, for every dealer and both desktop/server import paths. Real photos take priority; an all-placeholder gallery retains one placeholder. URL recognition covers common placeholder names and encoded NetDirector keys, but cannot identify arbitrary opaque image names by appearance. The original source URL remains in the approved audit evidence; review thumbnails show the iTrader artwork.

Manx's explicit label/value rows now supply fuel and transmission instead of leaving those fields unknown. Results use green completed/no-change labels, amber pending/conflict labels and red failed/blocked labels, alongside text. Clear completed results hides completed/no-change rows for the current administrator in that browser; Show cleared results restores them. Pending reviews and active jobs cannot be hidden by this action. Reject and clear dismisses an unapproved plan through the existing rejection action. Database audit history and listings are retained.

The 1.1.8 Preview-on-launch and confirmed Production-switch policy remains unchanged.

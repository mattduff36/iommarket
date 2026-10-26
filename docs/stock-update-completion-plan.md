# Stock Update: completion and acceptance plan

## Agreed result

One offline Windows installer, x64/ARM64 detection, Preview and Production selection, manual operation, browser authorisation using Matt and Dave's existing iTrader admin accounts. One restricted database worker login per environment. No extra website admin, no service, startup task, scheduled scraping, automatic approval, or embedded credentials.

**Current release scope is staging only.** Production activation and testing require separate approval. Do not overwrite the original installer until the connected staging acceptance gates below pass. A new installer must have a new version/hash, not silently replace version 1.0.0.

## Verified work and current boundary

The existing desktop app/runtime and backend are implemented. Earlier evidence records 3,583 project tests passed/six skipped, 14 native offline tests passed, x64/ARM64 cross-builds, and successful version 1.0.0 installation/reinstallation/removal on the development PC. These are historical results, not proof of the new provisioning code or a connected end-to-end test.

The new staging provisioner has been independently reviewed and its pure validation tests run. Its actual non-mutating check passed against the staging database and Vercel: two active approved admins, no queued/leased stock jobs, restricted worker role still NOLOGIN, existing applicable Redis settings, valid dedicated ImageKit input and accepted proposed configuration. A separate real Windows test passed DPAPI CurrentUser encryption/decryption, restrictive file ACL and corrupt-state rejection using non-secret data.

That initial setup blocker was resolved on 21 October 2026. Staging provisioning completed, the restricted worker login is active, and Preview configuration was deployed. Do not rerun provisioning as a routine resume step. Production configuration remains untouched.

### Connected acceptance recorded 22 October 2026

- Source commit `09ed785` passed typecheck and 3,672 project tests (six skipped). Its Preview deployment was verified at `itrader.dev`.
- The native x64 app restored its saved Preview session and opened Stock Reviews. Its actual connection check passed with the restricted login, bundled Chromium and image processing.
- Mike's Motors report `cmvjbcn6a000w18zjlns5zj42` was approved through the website and applied by job `cmvjbdpd1000108l6l77etgo5`. Two listings were created at the reviewed prices; each has a verified private ImageKit file under `/iommarket-media/staging/imports/`, a completed image receipt and an administrator-attributed create audit.
- Both new listing pages delivered their photos successfully. No production listings or media were changed.
- Repeat report `cmvjbhvug002i18zjioyx30mk` contains 29 unchanged vehicles and three missing-photo blocks, with no actionable changes or removals.
- Safe stop during that repeat scan drained the current job and stopped. Website revocation caused the app to reject its saved access and require sign-in. Fresh browser authorisation restored access; the subsequent read-only connection check passed.
- At the end of connected checks there were no queued/leased jobs, all weekly bindings were disabled, and the desktop app was closed.

Detailed local evidence is in `private/stock-update-acceptance-20261021/`: `applied-proof.json`, `repeat-review.json`, `connected-acceptance-end.json` and browser screenshots. The distinct 1.0.1 installer build and Surface acceptance are the next gates. The Surface is confirmed x64; no Surface result or ARM hardware execution is claimed. Live network-drop interruption and pairing expiry/replay coverage must be distinguished from the existing invalid-pairing and offline failure checks.

A real Franklin review contains seven unchanged listings and a blocked new Mazda, source ID 1933318. Inspection of the public dealer detail page confirmed an empty structured image field and only `/asset/images/noimage.jpg`. The block is correct. Do not use that vehicle as the successful photo-import acceptance case or remove the safeguard.

## 1. One-time staging configuration

Run on the **main Windows development PC**, not the Surface. The user-supplied keys are already in `D:\Websites\iommarket\.env.local`; the utility reads this file privately. It does not require local Redis credentials or alter `.env.local`.

```powershell
Set-Location 'D:\Websites\iommarket'
node .\node_modules\tsx\dist\cli.mjs .\scripts\stock-update-desktop\provision-staging.ts --check
node .\node_modules\tsx\dist\cli.mjs .\scripts\stock-update-desktop\provision-staging.ts --apply
```

The default/`--check` is non-mutating. `--apply` is the explicit owner action. It activates only the existing `itrader_stock_worker` login with a new random password, preserving existing grants, RLS and all elevated-role restrictions. Unused personal worker roles remain disabled. Both approved account entries use the same dedicated connection, not the website's database password.

Before activation, recovery state is encrypted with Windows DPAPI CurrentUser and restricted to the current user at `private/stock-update-desktop-build/provisioning/staging-shared.dpapi`. Keep this encrypted recovery file; do not copy its decrypted contents, edit it or publish it. Re-running setup reuses it instead of silently rotating an established password. An unknown already-active login or mismatching configuration stops setup for review.

After connection succeeds as the real worker login, the utility checks RLS visibility and a real row lock, and independently verifies SQL permission-denied for user-email reads, user-role changes and report-approval changes. These negative probes use separate savepoints so an aborted transaction cannot produce a false pass. All row-lock/probe work is rolled back.

Only these Vercel settings are written, all explicitly `preview` + `staging`, all sensitive, with the enable setting last:

- `DEALER_STOCK_DESKTOP_ALLOWED_ADMIN_IDS`
- `DEALER_STOCK_DESKTOP_CONFIG_JSON`
- `DEALER_STOCK_DESKTOP_ENABLED=1`

The dedicated ImageKit inputs map into that JSON only. Existing application ImageKit settings and all Production settings remain unchanged. A failure after this operation activates the login attempts to disable it and retains encrypted recovery state; a partial Vercel write may require review. Do not keep retrying a failed setup blindly.

Expected successful apply receipt: `ok:true`, `mode:"apply"`, `loginEnabled:true`, `configurationWritten:true`, `redeploymentRequired:true`. Only report this non-secret receipt. Do not paste the environment file or keys into a chat.

## 2. Deploy and verify staging configuration

Redeploy the reviewed `staging` commit as a Vercel Preview deployment, verify READY and assignment to `itrader.dev`, and confirm the Production alias/commit were not changed by this task. Changing environment variables alone does not update an existing deployment. Check access errors and real Redis-backed pairing; no session-store fallback and no removal of access checks to make a test pass.

## 3. Connected desktop acceptance, before installer publication

Prepare the corrected runtime/native app from the reviewed source without overwriting the distributable installer. In the system browser, sign out of the test-site session for the first-login case, begin pairing in Preview, complete ordinary admin login, verify computer/environment/code and explicitly authorise. Confirm the application identifies the right account/environment; passwords are never requested by the app. Test expired/invalid/replayed pairing and revoked access without exposing tokens.

Run Check connection: actual shared login, schema access, bundled Chromium and native image processing. It must not queue, lease, approve, apply or upload. Then verify no unrelated stock jobs are queued. Keep weekly sync disabled.

Queue ONE chosen dealer scrape in staging and start the app manually. Verify source completeness, exact identities/prices, blocked cases, and review output. Select a genuine eligible photo-bearing listing for the upload case; otherwise use an explicitly labelled isolated staging fixture, never a duplicate live dealer vehicle or another vehicle's photos. Approve through the normal admin page only. Verify the approved job, final listing state, owned ImageKit files in the staging media path, image receipts and audit attribution. Database/media-key availability is not proof of write permission or successful upload.

Queue a SECOND actual scrape after the apply and confirm it proposes no duplicate listing or repeated change. A read-only Check connection is not an idempotency test. Preserve sold-stock and incomplete-scrape protections. Test an interrupted connection and safe stop: current work drains, no further job is taken, no partial apply. Confirm app close, second-launch handling, device revocation and fresh-sign-in recovery. Do not test Production.

## 4. Installer 1.0.1 and independent-machine acceptance

Only after connected acceptance passes, advance native/protocol/package versions consistently, rebuild pinned x64/ARM64 payloads and publish a distinct `iTrader Stock Update Setup-1.0.1.exe` with SHA-256 and a release report. Confirm payload excludes secrets/config files and the installed app uses private runtimes/browser rather than system development tools.

Use the Surface as the independent Windows 11 test machine. Record its actual CPU architecture, install normally without admin elevation, test first launch/login/connection and the controlled Preview workflow, then upgrade/reinstall and uninstall. Verify session preservation on upgrade and app-owned data cleanup on uninstall. Cross-compilation does not prove ARM execution: test ARM hardware if it is required.

The build currently has no publisher signing certificate. Label internal unsigned test releases honestly, do not disable Windows security, and resolve signing/downloaded-file blocking before a normal Dave handover.

## Completion evidence and stop condition

Record exact commit, configuration target, deployment/alias, tests and limitations, job/report/listing IDs for the controlled staging run, photo verification, final installer version/hash and Surface outcome. Never include passwords, tokens, whole environments or provider credentials. The connected results recorded above are complete only to their stated scope; installer, independent-machine and remaining failure-scenario results need their own evidence. No Production activation is included in this plan.

# Windows PC dealer stock worker

Use this on a trusted Windows PC to process dealer stock jobs that an admin has already queued. The launcher runs one environment at a time, preview or production, and does not queue Friday weekly scrapes.

## Each time you sync

1. Double-click `scripts/dealer-stock-sync/start-worker.cmd`.
2. Type `1` for preview (`https://itrader.dev`) or `2` for production (`https://itrader.im`). A shortcut can pass `preview` or `production` instead of showing the menu.
3. Wait for **Dealer stock worker ready**. Leave the window open, keep the PC awake and connected to the internet. Start only one worker per environment.
4. Sign in as an administrator at [production dealers](https://itrader.im/admin/dealers) or [preview dealers](https://itrader.dev/admin/dealers). Find the dealer, open its **Actions**, then **Sync website stock**. Franklin's source is already configured.
5. Choose **Queue scrape** once. Refresh the page until the scrape finishes and a new report appears. Review the report before clicking **Approve exact plan**. Approval covers the whole eligible plan, not individual checkboxes. Choose **Reject** if the proposed changes are wrong.
6. Leave the worker running after approval. Refresh until the report shows **applied** and the latest job has finished. A console message saying processing finished is not proof of success; check the result on the website.
7. Check the public listing on that same site.
8. If you tested in preview, repeat the scrape and approval separately on production when ready. Preview approval does not copy listings to production.
9. Leave weekly sync disabled for each dealer.

To stop, type **Q** in the worker window and press **Enter**. Wait for the current job to finish and the worker to stop, then press a key to close the window. Do not close the window or shut down the PC during a job. No permanent service or scheduled PC task is installed.

## What to review

- **New**: check vehicle identity, price, description and photos against the dealer's site.
- **Changed**: check the proposed edits.
- **Missing once**: the vehicle stays published.
- **Proposed unpublish**: missing from two complete checks; approval removes it from public sale.
- **Blocked / Conflict**: these entries will not be applied. They need attention, such as missing photos or an existing manual edit. Approving the plan does not fix them.
- **Unchanged**: nothing to apply for those vehicles.

If the page offers **Enable weekly sync**, weekly checks are already off: leave it alone. If it offers **Disable weekly sync**, disable it before queuing your new scrape. These launchers never queue weekly checks, but will process jobs already queued in the selected environment. The worker can process any eligible dealer's queued work, not just the page currently open.

## If something stalls

- **Queued** for several minutes: check the worker is open, says ready, and shows the same site as your browser. Check the PC is awake and online; refresh the admin page.
- **Failed**, **blocked** or **stale**: read the admin message. Do not keep approving or rerunning blindly. Correct the cause, then queue a fresh scrape if needed. An interrupted run can take time for its job lease to expire; ask the developer to check before retrying.
- A partial or failed scrape must not be treated as proof that stock has disappeared.
- You can approve from another device, but the worker PC must remain running to process the approval.

## One-time PC setup

A developer provides and tests the installation once on each PC. The client does not need to run these commands for everyday use. The PC needs a trusted checkout compatible with the deployed site, including these launcher files. Do not auto-update the checkout while a worker is running.

1. Install Node.js 22 or newer. The launcher does not install it.
2. In the repository folder, run `npm ci`.
3. Run `npx prisma generate`. Do not run a database migration from this PC.
4. Run `npx playwright install chromium`. The launcher does not install the browser.
5. Place the developer-provisioned file at `private/dealer-stock-worker/preview.env` or `private/dealer-stock-worker/production.env`. `private/` is gitignored. Use `scripts/dealer-stock-sync/worker.env.example` as the key list only.
6. Do not point the launcher at `.env.local`. It builds the worker environment from Windows path and temp settings plus that one file.
7. Create desktop shortcuts to `scripts/dealer-stock-sync/start-worker.cmd production` and `scripts/dealer-stock-sync/start-worker.cmd preview`. Add `--check` for a configuration-only shortcut. Run the checks, then verify an approved preview job before handing over the client installation.

The configuration contains database and image-service credentials. Transfer it privately to a trusted administrator's PC, keep it out of Git and email, and do not include it in a launcher download. Keep an access-controlled backup. Never reuse preview credentials for production or the reverse. A copied shortcut alone will not install the software or credentials on another PC.

`DEALER_STOCK_SYNC_TARGET` inside the file must match the menu choice. Preview and production credentials stay in separate files. Leave `DEALER_STOCK_SYNC_PRODUCTION_ENABLED` unset until production has been explicitly accepted. The launcher will not turn that flag on.

Check the PC without starting work:

`node --import tsx scripts/dealer-stock-sync/pc-launcher.ts --target preview --check`

Preflight prints the site and `Weekly scrapes: off`. It validates configuration, browser availability and environment identities. It does not connect to the database, validate credentials with the providers, or process jobs. There is no VM requirement for these manual runs; the configured PC provides the worker while its window is open.

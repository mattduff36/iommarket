# Local ImageKit integration

This worktree serves the frozen 7,650-original ImageKit snapshot through iTrader while Cloudinary stays the default provider everywhere else.

## Run

1. `node scripts/imagekit/prepare-dev-env.mjs`
2. `npm run dev -- --port 4010`
3. Open `http://localhost:4010`

`MEDIA_PROVIDER=imagekit` is strict: a listing photo that does not exactly match the snapshot becomes the unmapped placeholder. Set `MEDIA_PROVIDER=cloudinary` and `NEXT_PUBLIC_MEDIA_PROVIDER=cloudinary` to roll back delivery without changing stored Cloudinary ids. `imagekit-sample` serves only `/iommarket-migration-sample/` from ImageKit.

The private key stays in the worktree `.env.local`. Do not print, commit, or send it to the browser.

`instrumentation.ts` now imports the Node error handler only when `NEXT_RUNTIME` is `nodejs`, which is the split in the installed Next.js guide. A fresh Next 16.3.8 webpack dev server otherwise tries to bundle the database client into the edge instrumentation graph and fails before any page loads.

## What was not changed

- The shared development database schema was not migrated. `scripts/imagekit/schema-proposal.sql` is the additive shape for a later, history-safe apply. `scripts/imagekit/backfill-dev.ts` is dry-run only and refuses `--apply` on this shared database.
- Migrated originals and the two seeded ImageKit demo files are not writable from this app. Uploads and deletes are limited to `/iommarket-dev-disposable/` and to file ids recorded in the local manifest.
- `resources-pass2.jsonl` was not present. `scripts/imagekit/reconcile-source.ts` records that and proposes no destination deletes. Re-run it after the existing backup writes pass 2. Do not start another Cloudinary Admin scan.
- Payments, Resend, cost sync and retention mutation are disabled in this worktree env only.

## Checks

- `npx vitest run __tests__/lib/imagekit-media.test.ts __tests__/components/listing-photo.test.tsx`
- `node --env-file=.env.local --import tsx scripts/imagekit/audit-references.ts`
- `node --env-file=.env.local --import tsx scripts/imagekit/validate-resolved.ts`
- `node --env-file=.env.local --import tsx scripts/imagekit/reconcile-source.ts`
- `node --env-file=.env.local --import tsx scripts/imagekit/live-disposable-media.ts`

## Result on 3 October 2026

The app is running at `http://localhost:4010` from `D:\Websites\iommarket-imagekit` on branch `codex/imagekit-integration`. Nothing was committed, pushed, or deployed.

Reference audit against the development database:

| Reference | Count |
| --- | ---: |
| Snapshot originals | 7,650 |
| Listing images | 6,691 |
| Exact Cloudinary asset id | 3,346 |
| Exact public id and version parsed from a stored Cloudinary URL | 1,860 |
| Unsplash, left on the stored URL | 297 |
| Seed Cloudinary URLs absent from the snapshot | 1,188 |
| Ambiguous matches | 0 |
| Revision images and avatars | 0 |
| Dealer logos matched by public id and version | 7 |
| Dealer logos on the production Supabase host, left unchanged | 2 |

Signed delivery returned HTTP 200 for all 5,206 resolved listing images. One unsigned ImageKit request returned 401. One mapped video original returned 200. Those four videos are not attached to listing rows. A focal crop at 0.15, 0.8 differed from the locally cropped original by a mean absolute channel delta of 4.53. The Vauxhall listing in the app requested the clamped extract `x-0,y-0,w-1448,h-905` for focal point 0.5027, 0.1483. The Audi listing gallery rendered on a 390px-wide viewport, and its social image was 1200×630. An anonymous request for that non-public listing image returned 404. Hidden sample listings are withheld by the media routes as well as the listing page. A dealer logo is signed only when the URL is that dealer's stored logo and the dealer is public, or the viewer is an admin. Other Cloudinary URLs are not signed.

Disposable upload run `fbfb5619-c315-4b83-9bb1-388587a61d67` stripped JPG, PNG and WebP, replaced a file, and deleted only those disposable files. HEIC/HEIF and MP4 are explicit unsupported listing-image formats in this environment. The disposable folder listing was empty afterwards.

`resources-pass2.jsonl` is still absent, so source reconciliation proposes no destination deletes. Leave the Cloudinary backup at `D:\Websites\iommarket-cloudinary-backup\2026-10-03T15-37-21-919Z` running. Do not start another Admin API scan. Re-run `scripts/imagekit/reconcile-source.ts` when pass 2 appears. That reconciliation is a gate before shared staging integration. Production cutover is a separate decision.

Today's result covers the frozen snapshot already uploaded. It is not current-source synchronisation and it is not the derivative or history archive.

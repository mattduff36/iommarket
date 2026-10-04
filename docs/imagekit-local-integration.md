# ImageKit integration

This integration serves the final 7,677-original ImageKit snapshot through iTrader. Production remains on Cloudinary.

## Run

1. Start the isolated PostgreSQL cluster on `127.0.0.1:55432` and export `DATABASE_URL`, `POSTGRES_URL`, and `POSTGRES_URL_NON_POOLING` to `postgresql://iommarket@127.0.0.1:55432/iommarket_imagekit`.
2. `npm run dev`
3. Open `http://localhost:4010`

`MEDIA_PROVIDER=imagekit` is strict: a listing photo that does not exactly match the snapshot becomes the unmapped placeholder. Set `MEDIA_PROVIDER=cloudinary` and `NEXT_PUBLIC_MEDIA_PROVIDER=cloudinary` to roll back delivery without changing stored Cloudinary ids. `imagekit-sample` serves only `/iommarket-migration-sample/` from ImageKit.

The private key stays in the worktree `.env.local`. Do not print, commit, or send it to the browser.

`instrumentation.ts` now imports the Node error handler only when `NEXT_RUNTIME` is `nodejs`, which is the split in the installed Next.js guide. A fresh Next 16.3.8 webpack dev server otherwise tries to bundle the database client into the edge instrumentation graph and fails before any page loads.

## Environment boundaries

- The additive Prisma migration is `prisma/migrations/20261004150000_imagekit_provider_fields`. It is applied to the isolated local database and the development Supabase project only. Production has not been migrated.
- `scripts/imagekit/backfill-dev.ts` is dry-run unless `--apply` is passed. It permits localhost by default. The development Supabase project additionally requires `IMAGEKIT_PREVIEW_BACKFILL_PROJECT=syneonzucehwlghqmfbg`; production and unknown databases are always refused.
- Migrated originals and the two seeded ImageKit demo files are not writable from this app. Uploads and deletes are limited to `/iommarket-dev-disposable/` and to file ids recorded in the local manifest.
- `resources-pass2.jsonl` remains the 7,660-row inventory and was not overwritten. The final inventory is a separate file. Destination deletions stay at zero.
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

## Result on 4 October 2026

The final Cloudinary inventory has 7,677 originals: 7,660 from pass 2 plus 17 private JPEGs found by the later scan. All 17 were downloaded, checksummed, and uploaded privately under `/iommarket-migration/`. Nothing was deleted. The canonical map has 7,677 one-to-one rows, 7,654 verified and 23 reused sample files. An independent mapping review passed with no duplicate paths, checksum mismatches, or ambiguous current destinations.

The integration is merged into local `staging`. The schema migration was applied to the development Supabase project after its project identity was verified. The reviewed backfill wrote 5,206 exact matches, left 297 non-Cloudinary references and 1,188 snapshot misses unchanged, and then reported 5,206 unchanged rows on a second dry run. Stored file id and path are the runtime source of truth. Strict ImageKit mode shows the unmapped placeholder when those fields are empty. Cloudinary rollback still uses the preserved public id and URL. Disposable ImageKit uploads have no Cloudinary identity and are not promoted.

Local checks on `http://localhost:4010`: the fixture card returned HTTP 200, the stored-identity photo redirected to ImageKit, an unsigned ImageKit request returned 401, the missing seed URL and the version mismatch returned the unmapped placeholder, and the social image was a 1200×630 JPEG. `tsc --noEmit` passed, lint reported 0 errors, and `npm run build` succeeded. The full unit suite passed 2,611 tests; three timeouts that appeared only while the dev server was running passed on their own.

Reviews: source mapping passed for all 7,677 originals; architecture passed; security found no medium or higher issues; the sample-mode disposable exception and the revision, expiry, archived-listing, and admin-delete identity gaps were fixed. The final diff review passed at `d0df087`.

The `staging` Vercel environment has branch-scoped ImageKit settings and can be rolled back without data changes by setting both `MEDIA_PROVIDER` and `NEXT_PUBLIC_MEDIA_PROVIDER` to `cloudinary`. Production cutover, production migration/backfill, capacity purchases, and ImageKit account security changes remain separate decisions.

## Production boundary

Do not apply the migration or backfill to production as part of staging work. Do not change production provider settings until the separate production cutover is approved.

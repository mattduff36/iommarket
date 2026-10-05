# ImageKit production readiness and Cloudinary retirement

Updated: 5 October 2026. This is an implementation checkpoint, not production activation approval.

## Release boundary

Work belongs to the canonical `D:\Websites\iommarket` checkout and `staging`. Preserve the separate database-merge and admin/profile changes. Production receives changes only through an approved staging-to-main pull request. Production data writes, provider activation, paid account changes, Cloudinary cancellation and destruction of originals remain separate approvals.

The new managed uploader is disabled unless `IMAGEKIT_UPLOADS_ENABLED=1`. No production or staging environment variable was changed by this readiness implementation. No real ImageKit asset was uploaded or deleted during its mocked tests. Production still uses Cloudinary. Existing staging delivery and its development-only disposable uploader remain separately configured.

## Implemented locally

### Images and delivery

- Image processing validates input bytes, decoded format, file size and pixel dimensions before encoding. EXIF rotation is applied before stored width/height are recorded. Metadata-removal tests cover all eight orientations and transparent PNG/WebP.
- Preserve the deployed responsive-quality repair and its bounded 160–2400 pixel ladder. Decorative blur remains separate from the foreground.
- Managed ImageKit-native images use their verified stored identity even when the preferred legacy read provider rolls back to Cloudinary. Imports retain the logical public IDs used by resume/audit tools while storing environment-separated ImageKit paths.
- Unsaved previews resolve an owner-authorized, verified, unexpired upload intent. Raw quarantine is never a listing-preview target. Consumed intents recheck the current listing or revision authorization.
- Dealer share cards resolve exactly mapped legacy logos through ImageKit in strict mode. Unmapped logos use the existing generic-card failure path. Supabase-hosted logos keep their existing store.

### Managed uploads

- The browser sends the large file directly to ImageKit's V2 endpoint. Our APIs receive small metadata or identifier requests, with an actual streamed byte limit rather than trusting Content-Length.
- A five-minute, one-use JWT binds the private quarantine folder, filename, size/type checks, overwrite prohibition and response options. Private keys remain server-side.
- Server finalization verifies the observed file ID/path/privacy/size, downloads bounded bytes, decodes and strips metadata, and uploads immutable sanitized output. It re-downloads that output and checks its hash before attachment.
- Expiry checks, conditional updates and durable cleanup receipts handle retries and lost upload responses. HEIC/HEIF follows a provider conversion path before server-side validation. Real hosted HEIC/HEIF acceptance is still unverified.
- The write provider is independent of the preferred read provider. Strict ImageKit configuration never silently issues a Cloudinary upload. A shared guard now refuses legacy Cloudinary upload signing when ImageKit writes are selected.

### Imports, deletion and rollback

- Preview-pack uploads, materialization and photo replacement carry provider identity and claim an import receipt in the same transaction as attachment.
- Per-path transaction locks serialize import attachment and cleanup. A used import path cannot create competing ownership receipts. Cleanup closes attachment rights before releasing its lock.
- Managed cleanup verifies environment, owner, observed ID/path and current live/open-revision references. A verified seller intent is expired under a row lock before deletion can race with attachment.
- Replacement, revision handling and account purge preserve ImageKit identities. Profile/migrated-original retention receipts remain held rather than silently losing the second provider identity.
- A provider error containing the words 'not found' is not treated as successful managed cleanup. Explicit missing-file handling remains in the ImageKit adapter.
- The production environment contract now validates the selected media provider. Present media secrets must remain sensitive, but credentials for an unused provider need not exist. No secret becomes part of the production environment mirror.

## Verification evidence

Evidence files are ignored local artifacts under `tmp/chatgpt-imagekit-readiness/`.

| Check | Result |
| --- | --- |
| Latest selected media, API, preview-pack and account lifecycle tests | 303 passed, zero failed, 51 test files; `final-media-tests.json` |
| TypeScript after the latest test typing correction | Passed, `tsc --noEmit --incremental false` |
| Scoped ESLint | Zero errors; one existing unused `isAdmin` parameter warning; `scoped-eslint-after-merge.json` |
| Complete repository suite | 2,838 passed, 11 failed, five skipped, 516 files; `full-suite-after-merge.json` |
| Hosted direct uploads, policy tampering, HEIC/HEIF, actual provider cleanup | Not performed; mocks are not hosted proof |
| Independent reviewer | Not performed in this connection; do not describe the local review as independent |
| Optimized build | Passed: worker preparation, Prisma generation and Next.js 16.3.8 optimized build; `isolated-build-result.json` |

The full-suite failures are outside this media change set and must not be silently repaired here:

- `__tests__/components/database-inspection.test.tsx`: one refresh-state assertion.
- `__tests__/components/database-panel.test.tsx`: two assertions against prior UI wording/Reset behavior.
- `__tests__/lib/database-sync-clone.test.ts`: one prior schema-count expectation.
- `__tests__/lib/database-sync-merge.integration.test.ts`: one pre-exclusion count expectation.
- `__tests__/lib/database-sync-worker.test.ts`: six fixtures expecting disabled Reset behavior or plans without the current exclusion-policy identity.

Recheck the actual branch after the database task updates those tests. The repository-wide suite is not green yet. These failures are not evidence that a database mutation should be rerun.

## Current read-only database audit

Captured at approximately `2026-10-05T02:43:37Z`, using verified TLS and explicit read-only transactions:

| Database/table | Rows | Complete ImageKit identity | Partial identity |
| --- | ---: | ---: | ---: |
| Production ListingImage | 4,685 | 0 | 0 |
| Production ListingRevisionImage | 8 | 0 | 0 |
| Staging ListingImage, CLOUDINARY provider | 3,346 | 3,346 | 0 |
| Staging ListingImage, EXTERNAL provider | 3,372 | 1,860 | 0 |
| Staging ListingRevisionImage | 0 | 0 | 0 |

Both databases already have `20261004150000_imagekit_provider_fields`. Do not rerun it to populate identity columns. The staging total is 5,206 complete mappings across 6,718 image rows. The remaining staging rows are not automatically approved production exclusions.

Reports: `current-mapping-snlqivvogfqesxpbjiei.json` and `current-mapping-syneonzucehwlghqmfbg.json`.

## Remaining production and retirement gates

1. **Make the complete staging release green.** Resolve the separate database-test failures, recheck the full release diff, finish the optimized build and independent review, then verify the exact staging deployment. Do not accidentally stage admin/profile work with media changes.
2. **Hosted provider acceptance.** Validate the V2 policy binding with real allowed and tampered requests, >4.5 MB through 10 MB input, HEIC/HEIF, private downloads, retries, replacement and cleanup. Both ImageKit keys are present as sensitive staging Vercel variables, but no usable local ImageKit key file was found. Do not weaken their protection or expose them through a diagnostic endpoint. Staging's admin-only gate and admin seller-upload prohibition must not be bypassed to manufacture a seller test pass.
3. **Recover and verify the retained map and originals.** The historical migration had 7,677 assets. Its earlier map/archive paths are no longer usable after the prior working-folder cleanup. The current checkout only has a test fixture, which must never be used as the real map. The checked NAS mirror roots did not establish a retained migration-map copy. This is not proof that no snapshot or other backup exists. Recover a retained copy or independently verify an exact reconstruction, including source versions and destination privacy/checksums.
4. **Complete the production reconciliation/application gate.** `scripts/imagekit/plan-production-backfill.ts` is read-only and has no apply flag. It creates an audited digest-bound identity plan from a real map. The conditional update and resume checks are tested building blocks, not a completed production apply runner. Reconcile any uploads since the migration snapshot, review the required delta, implement/review the apply runner and obtain approval before writes. Never copy staging business records onto production.
5. **Finish the operational dependency audit.** Preview-pack creation and replacement use the provider-aware service. Historical production repair tooling such as `scripts/dealer-pack-audit-sync/production-media.ts` remains Cloudinary-specific and now fails closed at the shared upload-signing guard in ImageKit-write mode. Migrate it or explicitly retire that workflow before claiming all operational dependencies are gone. Verify any older audit/removal runner preserves mapped cleanup identities before using it with migrated data.
6. **Approve and execute production cutover.** Verify backup recovery, coverage, account capacity/security, final source-write coordination, production credentials and paired provider flags. Deploy through the approved PR. Validate actual production behavior and keep Cloudinary available for the chosen observation window.
7. **Approve retirement separately.** Prove there are no required Cloudinary reads/writes across normal and scheduled/import workflows. Resolve held cleanup records and verify an independent original/map backup. Confirm the account serves no other project. Obtain explicit decisions for the observation period, cancellation, credential revocation and deleting originals. These are separate actions.

## Next-session entry point

Read this file, `AGENTS.md`, `tmp/chatgpt-imagekit-readiness/release-scope.json`, the latest checkpoint and current Git status before editing. Refresh HEAD and origin/main/staging. Preserve unrelated changes and do not reuse an old reported test count as a fresh pass. Start with any remaining code/review failures, then perform hosted acceptance and real reconciliation before offering a production activation approval.

## Primary references

- ImageKit V2 upload contract: https://imagekit.io/docs/api-reference/upload-file/upload-file-v2
- ImageKit delivery/original transformations: https://imagekit.io/docs/core-delivery-features
- Vercel Function payload limits: https://vercel.com/docs/functions/limitations
- Sharp input/output behavior: https://sharp.pixelplumbing.com/

V2 remains documented as beta in the retrieved contract. Its actual account/runtime behavior must be tested rather than inferred from unit tests.

## Release checkpoint

The optimized build completed at `2026-10-05T02:55:59Z`. It used an unreachable loopback database and cleared external write credentials. Worker preparation, Prisma generation and Next build were run directly after the npm prebuild wrapper stopped without a useful error. This validates compilation and static generation, not hosted provider behavior.

A media-only local checkpoint is being prepared. Do not push or merge on the strength of this file alone. The complete repository test run remains red, and hosted acceptance plus the real production map/application plan are still open. Production and both hosted database contents were not changed by this implementation.

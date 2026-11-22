# Part 1 staging release — 22 November 2026

Scope: Featured checkout recovery and offer layout; admin Featured filter; owner draft deletion; NEW/USED across marketplace and stock workflows; five dealer preview sources; optional Dealer Pro source links and consent-aware click events. Production requires owner approval after staging testing.

## Review notes

- Featured checkout keeps provider/webhook logic. The UI reports the actual tab-open outcome, offers direct new-tab/same-tab recovery and reuses its existing checkout URL. Archived drafts are rejected before payment entrypoints. Payment and offer regression run: 52 tests passed.
- Dealer source URLs are restricted to their registered source origin and existing URL safety checks. Dealer Pro profile setting defaults on; links open with noopener/noreferrer. Clicks use the existing consent-aware event pipeline. Dealer stats display is deferred.
- Admin Featured filter preserves other filters and pagination query state.
- Windows typecheck bootstrapping falls back from native realpath only for EPERM when ordinary traversal succeeds. Prisma generation, Next route types and TypeScript still run; access failures are not ignored.
- Draft/condition changed-file review and targeted evidence: `part1-drafts-condition-verification.md`.
- New connector coverage: H&H actual used stock, BVS Dragon2000 and three advertiser-scoped Van Mossel feeds. H&H catalogue-only New entries remain excluded pending evidence of actual stock. New source fixtures exercise pagination, advertiser scope, condition and details.

## Staging data

Three migrations applied to staging project `syneonzucehwlghqmfbg`. This is a persistent Supabase branch of the production project, not a disconnected project; direct SQL works. Local restricted-network access and top-level project discovery caused the earlier misleading connection diagnosis.

Backfill evidence and source/archive receipts are retained under `private/condition-backfill` and `private/part1`. Unknown existing dealer conditions use the agreed Used fallback with admin review flags when the uncertain set exceeds ten.

## Release checks

Windows stock-update 1.1.15 source is prepared but its build/publish is on hold at the owner's request, pending additional UI/UX changes. Website staging deployment may proceed independently. Installed desktop clients will need that later release to use the new connectors and preserve the New/Used field.

Run registered full finalise gates before staging push: typecheck, complete test suite, lint and production build. Verify the resulting commit is READY at itrader.dev. Manual approval remains required before any staging-to-main merge.

## Local folder consolidation

Canonical project root: `D:\Websites\iommarket`. Two redundant clean worktrees were found: `D:\Websites\iommarket-dealer-eligibility` and `D:\Websites\iommarket-stock-removal`. Neither has unique commits relative to staging. Their node_modules entries are junctions into the canonical root; preserve that target. After staging deployment, preserve any required private evidence, remove junctions without traversing them, remove worktrees, and retain only this canonical checkout. Move task-specific temporary evidence/documents into this root. Shared installed tools and Windows-managed temporary files are not project worktrees.

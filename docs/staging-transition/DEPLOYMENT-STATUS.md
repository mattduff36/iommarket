# Staging transition verification

3 October 2026: application commit `ac2e172` was deployed READY as `dpl_4K27TGKi9gzDZfQeRjSwxsoUWtKH`. `preview.itrader.im` is branch-connected to `staging`; production remains connected to `main` at `a796c3b`. The old `preview` branch is retained. Draft PR #14 proposes staging into main and has not been merged.

The registered full finalise passed: typecheck, 2,420 tests (one skipped), lint with zero errors and 60 warnings, and build. Both GitHub Quality validations passed for this application commit. GitGuardian flagged a placeholder PostgreSQL password in a mocked test connection; the follow-up removes that unused password. It also pins shell-hook line endings to LF for Windows checkouts. Check the latest PR head and its checks before production promotion.

Verified on the deployed staging application:

- Anonymous `/` redirects to `/staging-access`; the gate returns 200 and `X-Robots-Tag: noindex`.
- Anonymous `/api/me` returns 401, also noindex.
- The user signed in with a development administrator account. The dashboard, checklist (28 items), preview packs (35 packs) and database inspection page rendered successfully.
- An authenticated Athol Garage preview listing rendered its photos, price and specifications, retained a preview canonical and `noindex, nofollow`, and emitted no public Product structured data. An eligible public listing's SEO remains a separate verification requirement.
- The database page reports its dedicated production read-only connection as unconfigured. No sync is available and no database migration, replacement or merge was run.
- The previous preview deployment URL and preview branch URL both redirect anonymous requests to Vercel authentication. Moving the public custom hostname does not leave those historical URLs anonymously accessible in the checks performed.
- Production `/` remains HTTP 200 with its public title and without a preview noindex header.
- The staging deployment error-log query over the verification window returned no error entries. This is a bounded observation, not a guarantee that every journey works.

Main is protected by required pull requests and a strict successful `validate` check, including administrators; force pushes and deletion are disabled. Local finalise and the installed pre-push hook reject main pushes. Staging environment overrides were moved from preview without changing their values; the explicit staging role and advertising-off setting apply only to the staging branch in Vercel Preview. All effective database URLs were checked against the development project without printing credentials.

## Remaining work

Production feature restrictions take effect only after reviewed PR promotion. The historical production checklist row and dealer-pack records are retained pending backed-up reconciliation. Replace and Merge remain separate planned operations; see DATABASE-SYNC.md. Live advertising remains blocked pending durable payment/consent reporting, provider attribution and test receipt. Combined monitoring is a recommendation, not an implemented cross-environment dashboard.

# Staging hostname cutover

The development hostname is `https://itrader.dev`. All subsequent development remains on `staging`; `main` is updated only through the reviewed pull request.

The staging runtime's exact allowed origin, auth and email link origin, and signed Ripple test-product relay destination use `https://itrader.dev`. Hosted staging still requires `VERCEL_ENV=preview`, `ITRADER_DEPLOYMENT_ROLE=staging`, the development Supabase project, and that exact app origin. Relay signatures, the relay secret, and the production webhook `https://itrader.im/api/webhooks/ripple` stay unchanged.

Cashflows still returns the browser to the production `/pay/success`, `/pay/failed`, and `/pay/cancelled` pages. `itrader.dev` cannot set a `.itrader.im` cookie, so staging checkout opens a signed handoff on `https://itrader.im/pay/staging-handoff`. Production verifies that ticket with `RIPPLE_STAGING_RELAY_SECRET`, sets a host-only `itrader-checkout-return` cookie, and continues only to the signed Ripple URL. The later production return copies allowlisted provider fields to `https://itrader.dev` and clears the marker. The old `preview.` cookie is ignored. The handoff and return route are live only after this code is running in production.

## Dashboard steps still required

Already in place, and left unchanged by this code: `itrader.dev` is attached to the staging branch and verified. An anonymous request reaches `/staging-access` with `X-Robots-Tag: noindex` and does not show Vercel login. `https://staging.itrader.im` currently redirects to `https://itrader.dev`. The staging-scoped `NEXT_PUBLIC_APP_URL` is now `https://itrader.dev` and applies on the next staging deployment. Production `NEXT_PUBLIC_APP_URL` was not changed.

1. Deploy this staging commit so the running build uses `https://itrader.dev` for auth links, the staging identity check, and the relay receiver. Do not deploy production from this change.
2. In the development Supabase project `syneonzucehwlghqmfbg` only, set Site URL to `https://itrader.dev` and add `https://itrader.dev/auth/callback` to the redirect allowlist. The management token available here was rejected, so this was not saved. Do not change the production project. There is no Auth Hook to move.
3. Promote staging to production through the reviewed pull request before signed test-link relays and checkout handoffs can use `https://itrader.dev`. The running production build still posts to `https://staging.itrader.im/api/webhooks/ripple-staging` and refuses redirects. Leave the Ripple production webhook on `https://itrader.im/api/webhooks/ripple`.
4. After that production release, remove `https://staging.itrader.im` and `https://staging.itrader.im/auth/callback` from the development allowlist.
5. `https://preview.itrader.im` currently redirects to `https://itrader.dev`, so its production retired-404 response does not run. Restoring that response is a production domain change and was not made.

## Earlier cutover on 3 October 2026

The owner approved PR #14 production promotion and first requested `staging.itrader.im`. That hostname, its protection exception, and the development Supabase Site URL `https://staging.itrader.im` were the previous staging binding. `preview.itrader.im` stays a production-only retired 404. Generated deployment URLs retained project protection.

- The owner saved the development Supabase Site URL as `https://staging.itrader.im` and added `https://staging.itrader.im/auth/callback`. These values were inspected in `syneonzucehwlghqmfbg`. Its Auth Hooks page had no configured hooks.
- The root sitemap index uses native Next metadata partitions under `/catalogue/sitemap/{id}.xml`.
- The verified `itrader.im` domain property is visible in Google Search Console. Submit only production sitemap URLs.

The retired response is production-only. This hostname change does not change database contents or enable live advertising. Database Replace/Merge remain separate unfinished work described in DATABASE-SYNC.md.

## Cutover checks on 3 October 2026

- `staging.itrader.im` is attached to the staging branch. Its exact Vercel Deployment Protection exception was added by the owner; generated deployment URLs retain project protection.
- Anonymous requests reach the application's administrator gate. The gate and sign-in return HTTP 200 with noindex, protected pages redirect to the gate, and an anonymous API request returns 401. Robots publishes no sitemap and `/sitemap.xml` returns 404 with noindex.
- The owner saved the development Supabase Site URL as `https://staging.itrader.im` and added `https://staging.itrader.im/auth/callback`. These values were inspected in the development project `syneonzucehwlghqmfbg`. Its Auth Hooks page has no configured hooks, so there is no old hook endpoint to migrate; email delivery itself has not been tested.
- The root sitemap index uses native Next metadata partitions under `/catalogue/sitemap/{id}.xml`. Placing a separate index beside a root `app/sitemap.ts` caused a build conflict in the installed Next version; nesting the metadata file avoids that conflict without replacing native XML serialization.
- The verified `itrader.im` domain property is visible in the owner's personal Google Search Console. Submission waits for production deployment and live sitemap verification.

These observations do not by themselves confirm production promotion or old-host retirement. Record those outcomes after the merge and alias checks.

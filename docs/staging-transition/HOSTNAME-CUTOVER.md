# Staging hostname cutover

The owner approved PR #14 production promotion on 3 October 2026 and requested `staging.itrader.im` as the development hostname. All subsequent development remains on `staging`; `main` is updated only through the reviewed PR.

The staging runtime's exact allowed origin, checkout return destination and signed Ripple test-product relay destination now use `https://staging.itrader.im`. Keep the existing `preview.` checkout cookie marker, `VERCEL_ENV=preview`, database identity, relay signatures and secrets unchanged. These are compatibility and security boundaries, not the hostname.

Cutover order:

1. Add the staging domain and update the staging-scoped `NEXT_PUBLIC_APP_URL`; deploy and verify its administrator gate and noindex policy.
2. Update the development Supabase Auth Site URL, applicable redirects and send-email hook to the new owned hostname. Preserve signing secrets.
3. Merge the checked staging head into main and verify the production deployment, including the new signed relay destination.
4. Move `preview.itrader.im` from the staging branch to production solely to serve its retired-host response. Every path on that hostname returns a branded HTTP 404 and noindex; it no longer hosts the application. Keep DNS/TLS so visitors receive this response instead of a connection error.
5. Verify old-host page, API, image, static asset and HEAD requests, plus new staging noindex and production robots/sitemaps/canonicals.
6. Submit only production sitemap URLs and production indexing requests in the confirmed `itrader.im` Search Console property. Never submit staging or the retired preview hostname.

The retired response is production-only so existing signed test renewal callbacks remain available on the old staging alias until production has deployed the new relay target. This cutover does not change database contents or enable live advertising. Database Replace/Merge remain separate unfinished work described in DATABASE-SYNC.md.

## Cutover checks on 3 October 2026

- `staging.itrader.im` is attached to the staging branch. Its exact Vercel Deployment Protection exception was added by the owner; generated deployment URLs retain project protection.
- Anonymous requests reach the application's administrator gate. The gate and sign-in return HTTP 200 with noindex, protected pages redirect to the gate, and an anonymous API request returns 401. Robots publishes no sitemap and `/sitemap.xml` returns 404 with noindex.
- The owner saved the development Supabase Site URL as `https://staging.itrader.im` and added `https://staging.itrader.im/auth/callback`. These values were inspected in the development project `syneonzucehwlghqmfbg`. Its Auth Hooks page has no configured hooks, so there is no old hook endpoint to migrate; email delivery itself has not been tested.
- The root sitemap index uses native Next metadata partitions under `/catalogue/sitemap/{id}.xml`. Placing a separate index beside a root `app/sitemap.ts` caused a build conflict in the installed Next version; nesting the metadata file avoids that conflict without replacing native XML serialization.
- The verified `itrader.im` domain property is visible in the owner's personal Google Search Console. Submission waits for production deployment and live sitemap verification.

These observations do not by themselves confirm production promotion or old-host retirement. Record those outcomes after the merge and alias checks.

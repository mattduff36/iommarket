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

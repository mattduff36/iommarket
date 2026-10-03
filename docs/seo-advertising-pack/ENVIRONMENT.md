# Advertising and indexing environment

Placeholder names only. Do not put real tokens in this file or in chat.

Indexing does not use a request host, query or cookie. Production pages can be indexed only when `VERCEL_ENV=production`, `NODE_ENV=production` and the existing launch gate is open. Preview, local, test and unknown deployments send `X-Robots-Tag: noindex` and publish an empty sitemap. Preview robots stay crawlable so a previously indexed URL can be removed. That is not access control.

| Name | Purpose |
| --- | --- |
| `ADVERTISING_DELIVERY` | `off` (default), `test` or `live` |
| `META_DATASET_ID` | Live Meta dataset |
| `META_PIXEL_ID` | Live browser pixel; defaults to the live dataset id |
| `META_CAPI_ACCESS_TOKEN` | Live server token |
| `META_TEST_DATASET_ID` | Test Meta dataset; must differ from the live dataset |
| `META_TEST_PIXEL_ID` | Test browser pixel |
| `META_TEST_CAPI_ACCESS_TOKEN` | Test server token |
| `GA4_MEASUREMENT_ID` | Live GA4 id, `G-...` |
| `GA4_API_SECRET` | Live GA4 Measurement Protocol secret |
| `GA4_TEST_MEASUREMENT_ID` | Test GA4 id; must differ from live |
| `GA4_TEST_API_SECRET` | Test GA4 secret |
| `GOOGLE_ADS_ID` | Live Ads id, `AW-...` |
| `GOOGLE_ADS_CONVERSION_LABEL` | Live browser conversion label |
| `GOOGLE_ADS_TEST_ID` | Test Ads id |
| `GOOGLE_ADS_TEST_CONVERSION_LABEL` | Test conversion label |

`live` is ignored unless the deployment is production. `test` never reads the live variables. Missing credentials leave the integration disabled and pages still render. Advanced matching is off. Google tags load only after marketing consent, so denied-state cookieless pings are not enabled.

Campaign attribution is a first-party cookie, `itrader-campaign`, kept for 90 days and only after marketing consent. It is not a database migration. See `PROPOSED-ATTRIBUTION.sql`, which is not applied.

# Google Analytics 4 for iTrader

iTrader tracks public-site page views and marketplace events in GA4 only after a visitor grants analytics-cookie consent. The production web stream is `itrader.im`, with measurement ID `G-6PD78XKCZ6` and property ID `557226172`.

## Tracking and consent

- Set `GA4_MEASUREMENT_ID=G-6PD78XKCZ6` in the Vercel **Production** environment scope only. The app also checks `VERCEL_ENV=production` and the live hostname before sending events, so preview deployments do not send browser analytics.
- The Google tag waits for the site's analytics consent choice. It sends a limited, fixed page title and public page path; query strings and fragments are removed, and private paths are excluded. Marketplace event properties are sanitized before sending.
- In the GA4 web stream, turn **Enhanced Measurement off**. The app sends its own page views for Next.js client-side navigation; GA4's automatic browser-history page views would duplicate them.
- No DNS change is needed for GA4 tracking or the Data API connection. No historical data can be backfilled by adding the tag; collection starts once it is deployed and visitors consent.

## Read-only reports in `/admin/analytics`

The dashboard uses the Google Analytics Data API to read users, page views, event counts, and device categories. Its service account requires the GA4 **Viewer** role on property `557226172`; it does not need edit access.

1. In the Google Cloud project used for iTrader Analytics, enable the **Google Analytics Data API**.
2. Create a service account and a JSON key. In GA4 Admin, add its service-account email under property access management with the **Viewer** role.
3. Set these server-only Vercel environment variables:

   | Variable | Value |
   | --- | --- |
   | `GA4_PROPERTY_ID` | `557226172` |
   | `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service-account email ending in `iam.gserviceaccount.com` |
   | `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | The JSON key's private key; Vercel can store real newlines, and the app also accepts `\n` escapes |

4. Set the three report variables in **Production**. To let the staging/preview admin dashboard read the same production property, set them in **Preview**, restricted to the `staging` branch. The Preview credentials are read-only, and preview browser tracking remains disabled.

The server requests only the `analytics.readonly` OAuth scope, does not send credentials to the browser, and times out report calls. A successful empty report is shown separately from missing credentials or a failed API request. A newly configured property may report no data until consented production visits have been processed.

Example variable names and placeholders are in [`.env.example`](../.env.example). Never put the real service-account key in source control or client-side environment variables.

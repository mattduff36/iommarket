# iTrader favicon package

The approved version A master is `brand-assets/source/itrader-icon-a.png`.
Regenerate the active icon files with `node scripts/generate-favicons.mjs`.
This preserves the approved artwork, including its black background; the SVG
embeds a PNG instead of substituting a different vector drawing.

## Active files

- `app/favicon.ico`: the sole owner of `/favicon.ico`, with 16, 32, 48, 64,
  128 and 256 pixel frames. Do not add a conflicting `public/favicon.ico`.
- `app/icon.png`: automatically discovered 48 pixel browser icon.
- `app/apple-icon.png`: automatically discovered opaque 180 pixel Apple icon.
- `public/favicon.svg`, `favicon-16x16.png`, `favicon-32x32.png`: browser formats.
- `public/apple-touch-icon.png` and `apple-touch-icon-precomposed.png`: Apple aliases.
- `public/icon-192.png` and `icon-512.png`: ordinary PWA icons.
- `public/icon-maskable-192.png` and `icon-maskable-512.png`: padded PWA icons;
  all artwork fits inside the central maskable safe circle.
- `public/images/icon-itrader.png` and `icon-itrader-trans.png`: legacy icon URLs,
  both now intentionally opaque to preserve the approved black background.

`lib/seo/favicons.ts` supplies explicit metadata. Next.js also discovers the
app-folder files and generates content-versioned URLs for the PNG icons.
`public/site.webmanifest` distinguishes ordinary and maskable icons.
Explicit URLs carry the version `itrader-a-20261007` to refresh old cached icons.
Keep these versions aligned when replacing the artwork in the future.

The full horizontal iTrader logo is unchanged. Historical `brand-assets/favicon`
and `brand-renderer/output` files are not served by the site; do not copy these old
concepts into the active paths. Use the favicon generator above for this package.

## Verification and release

Run `npm run test:run -- __tests__/app/favicon-metadata.test.ts` to check metadata,
pixel identity, ICO contents, Apple opacity, maskable padding and route ownership.
After deployment, inspect the rendered icon links and manifest, and verify each
linked URL returns the expected image with HTTP 200.

Deploy through the normal staging-first release process. Already installed iOS
home-screen shortcuts can retain their previous icon; remove and re-add those
shortcuts after deployment if they do not refresh.

# Social image review — 3 October 2026

The SEO pack added one image, `public/og/itrader-social.png` (1200×630). Visual review found a simplified replacement brand mark and a clipped `.im` ending. The owner requested replacement with the existing official artwork.

The replacement uses `public/images/logo-itrader-hq.png` (1399×392), proportionally resized to 1040×291 and centred on an opaque 1200×630 `#050405` background. No lettering or logo was redrawn. The metadata URL adds `?v=official-20261003` so social crawlers see a new image URL. Existing platform share caches may still need refreshing. Organisation structured data now refers to the official logo asset rather than the wide social card.

At the initial shared-card review, image selection elsewhere was unchanged:

- Homepage, search, category and marketing landing pages use the shared social card.
- Listing pages use the first ordered listing photo with the existing Cloudinary social transformation, falling back to the shared card if no usable photo exists.
- Dealer pages use their uploaded HTTPS logo, falling back to the shared card.
- Favicons and app icons were not changed by the SEO pack.

Follow-up issues found during that review: dealer logos were not padded or normalised for wide cards; external listing image URLs could be declared as 1200×630 without matching those dimensions; and a placeholder first photo could be selected ahead of the branded fallback. The follow-up below addresses dimensions and dealer cards; automatic placeholder selection remains unchanged. No new advertising creatives or campaigns were created.

## Follow-up implementation — 3 October 2026

The following fixes are implemented and locally verified. This section is not evidence of deployment; the release record must identify the staging/production deployment separately.

- Cloudinary's padded social-image stages now remain slash-separated instead of being flattened into one comma-separated transformation. Simple crop transformations remain grouped. A real signed derivative for listing `cmt4lka4j005ptgzj79iidzxy` returned HTTP 200 and decoded to 1200×630 after the fix.
- Untransformed external listing images now advertise their recorded original dimensions, or omit dimensions when unknown, rather than incorrectly declaring every image as 1200×630.
- Public dealer metadata points to a 1200×630 PNG card containing the complete official uploaded dealer logo with proportional containment. Ocean Motor Village's actual 250×250 source logo rendered successfully into a 1200×630 card and was visually inspected without cropping or redrawing the mark.
- The dealer-card endpoint checks public dealer eligibility, accepts no arbitrary image-URL parameter, restricts asset origins, pins public DNS addresses, rejects redirects, bounds download size/time and falls back to the existing official shared card. Staging copies can read the pinned production public-avatar origin without receiving storage ownership.
- Signed read-only image references produced by database sync are preserved without double-signing. An actual original-image request returned HTTP 200 at 960×720; its external metadata retains that size.

The example listing's source was already the dealer's "Awaiting images" artwork. It remains the listing's selected image; this work does not invent vehicle photographs or replace existing dealer placeholders automatically. The official shared iTrader card, favicons and original vehicle/dealer assets remain unchanged.

Local visual evidence is available in the ignored working folder `.local/social-images/listing-social.jpg` and `.local/social-images/dealer-social.png`. Tests cover transform chains, original dimensions, real PNG output, eligibility, unsafe image sources, fallback rendering, and read-only media cleanup protection. Live verification must still fetch the deployed metadata URLs and check their response type, decoded dimensions and appearance.

# Social image review — 3 October 2026

The SEO pack added one image, `public/og/itrader-social.png` (1200×630). Visual review found a simplified replacement brand mark and a clipped `.im` ending. The owner requested replacement with the existing official artwork.

The replacement uses `public/images/logo-itrader-hq.png` (1399×392), proportionally resized to 1040×291 and centred on an opaque 1200×630 `#050405` background. No lettering or logo was redrawn. The metadata URL adds `?v=official-20261003` so social crawlers see a new image URL. Existing platform share caches may still need refreshing. Organisation structured data now refers to the official logo asset rather than the wide social card.

Image selection elsewhere is unchanged:

- Homepage, search, category and marketing landing pages use the shared social card.
- Listing pages use the first ordered listing photo with the existing Cloudinary social transformation, falling back to the shared card if no usable photo exists.
- Dealer pages use their uploaded HTTPS logo, falling back to the shared card.
- Favicons and app icons were not changed by the SEO pack.

Follow-up issues found during this review: dealer logos are not padded or normalised for wide cards; external listing image URLs can be declared as 1200×630 without matching those dimensions; and a placeholder first photo can be selected ahead of the branded fallback. These require separate image-selection work and are not fixed by replacing the shared card. No new advertising creatives or campaigns were created.

import { describe, expect, it } from "vitest";
import { metadata as categoriesMetadata } from "@/app/(public)/categories/page";
import { metadata as contactMetadata } from "@/app/(public)/contact/page";
import { metadata as dealersMetadata } from "@/app/(public)/dealers/page";
import { metadata as pricingMetadata } from "@/app/(public)/pricing/page";
import { metadata as faqMetadata } from "@/app/(public)/faq/page";
import { metadata as safetyMetadata } from "@/app/(public)/safety/page";
import { metadata as vehicleCheckMetadata } from "@/app/(public)/vehicle-check/page";
import { metadata as termsMetadata } from "@/app/(public)/terms/page";
import { metadata as privacyMetadata } from "@/app/(public)/privacy/page";
import { metadata as acceptableUseMetadata } from "@/app/(public)/acceptable-use/page";
import { metadata as cookiesMetadata } from "@/app/(public)/cookies/page";
import { metadata as dealerTermsMetadata } from "@/app/(public)/dealer-terms/page";
import { metadata as privateSellerTermsMetadata } from "@/app/(public)/private-seller-terms/page";
import { metadata as refundsMetadata } from "@/app/(public)/refunds/page";
import { metadata as vehicleCheckTermsMetadata } from "@/app/(public)/vehicle-check-terms/page";
import { metadata as homeMetadata } from "@/app/(public)/page";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";

describe("static public page canonicals", () => {
  it.each([
    [categoriesMetadata, "/categories"],
    [contactMetadata, "/contact"],
    [dealersMetadata, "/dealers"],
    [pricingMetadata, "/pricing"],
    [safetyMetadata, "/safety"],
    [faqMetadata, "/faq"],
    [vehicleCheckMetadata, "/vehicle-check"],
    [termsMetadata, "/terms"],
    [privacyMetadata, "/privacy"],
    [acceptableUseMetadata, "/acceptable-use"],
    [cookiesMetadata, "/cookies"],
    [dealerTermsMetadata, "/dealer-terms"],
    [privateSellerTermsMetadata, "/private-seller-terms"],
    [refundsMetadata, "/refunds"],
    [vehicleCheckTermsMetadata, "/vehicle-check-terms"],
    [homeMetadata, "/"],
  ])("uses the shared canonical origin", (metadata, path) => {
    expect(metadata.alternates?.canonical).toBe(buildCanonicalUrl(path));
    expect(metadata.openGraph).toMatchObject({
      type: "website",
      siteName: "itrader.im",
      locale: "en_GB",
      url: buildCanonicalUrl(path),
      description: metadata.description,
    });
    expect(metadata.openGraph?.title).toBeTruthy();
    expect(metadata.openGraph?.images).toEqual(expect.arrayContaining([
      expect.objectContaining({ width: 1200, height: 630, alt: expect.any(String) }),
    ]));
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      title: metadata.openGraph?.title,
      description: metadata.description,
      images: [expect.objectContaining({ alt: expect.any(String) })],
    });
  });
});

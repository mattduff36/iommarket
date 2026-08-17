import { describe, expect, it } from "vitest";
import { metadata as categoriesMetadata } from "@/app/(public)/categories/page";
import { metadata as contactMetadata } from "@/app/(public)/contact/page";
import { metadata as dealersMetadata } from "@/app/(public)/dealers/page";
import { metadata as pricingMetadata } from "@/app/(public)/pricing/page";
import { metadata as safetyMetadata } from "@/app/(public)/safety/page";
import { metadata as vehicleCheckMetadata } from "@/app/(public)/vehicle-check/page";
import { metadata as termsMetadata } from "@/app/(public)/terms/page";
import { metadata as privacyMetadata } from "@/app/(public)/privacy/page";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";

describe("static public page canonicals", () => {
  it.each([
    [categoriesMetadata, "/categories"],
    [contactMetadata, "/contact"],
    [dealersMetadata, "/dealers"],
    [pricingMetadata, "/pricing"],
    [safetyMetadata, "/safety"],
    [vehicleCheckMetadata, "/vehicle-check"],
    [termsMetadata, "/terms"],
    [privacyMetadata, "/privacy"],
  ])("uses the shared canonical origin", (metadata, path) => {
    expect(metadata.alternates?.canonical).toBe(buildCanonicalUrl(path));
  });
});

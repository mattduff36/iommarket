import { describe, expect, it } from "vitest";
import { previewImagePublicId } from "@/lib/preview-packs/upload";
import {
  identityKeyFromPreviewPublicId,
  planPreviewPackResume,
  previewListingFingerprint,
} from "@/lib/preview-packs/resume";

describe("preview pack resume plan", () => {
  it("reads the identity key from a preview Cloudinary public id", () => {
    const publicId = previewImagePublicId("athol-garage", "source-99", 2);
    expect(identityKeyFromPreviewPublicId(publicId, "athol-garage")).toBe("source-99");
    expect(identityKeyFromPreviewPublicId(publicId, "mikes-motors")).toBeNull();
  });

  it("creates missing vehicles, backfills listings with no photos, and skips complete ones", () => {
    const completePublicId = previewImagePublicId("athol-garage", "car-complete", 0);
    const plan = planPreviewPackResume({
      dealerKey: "athol-garage",
      vehicles: [
        {
          identityKey: "car-new",
          title: "2020 Ford Fiesta",
          pricePence: 1_000_000,
          mileage: "10000",
          sourceCount: 4,
        },
        {
          identityKey: "car-empty",
          title: "2018 BMW 320d",
          pricePence: 2_000_000,
          mileage: "40000",
          sourceCount: 3,
        },
        {
          identityKey: "car-complete",
          title: "2019 Audi A3",
          pricePence: 3_000_000,
          mileage: "20000",
          sourceCount: 1,
        },
      ],
      listings: [
        {
          id: "listing-empty",
          title: "2018 BMW 320d",
          pricePence: 2_000_000,
          mileage: "40000",
          images: [],
        },
        {
          id: "listing-complete",
          title: "2019 Audi A3",
          pricePence: 3_000_000,
          mileage: "20000",
          images: [{ publicId: completePublicId, order: 0 }],
        },
      ],
    });

    expect(plan).toEqual([
      { kind: "create", identityKey: "car-new" },
      {
        kind: "backfill",
        identityKey: "car-empty",
        listingId: "listing-empty",
        missingOrders: [0, 1, 2],
      },
      { kind: "complete", identityKey: "car-complete", listingId: "listing-complete" },
    ]);
  });

  it("matches by fingerprint when photos were never uploaded", () => {
    expect(
      previewListingFingerprint({
        title: "2020 Ford Fiesta",
        pricePence: 1_000_000,
        mileage: "10000",
      }),
    ).toBe("2020 ford fiesta|1000000|10000");
  });
});

import { describe, expect, it } from "vitest";
import { previewImagePublicId } from "@/lib/preview-packs/upload";
import {
  identityKeyFromPreviewPublicId,
  planPreviewPackResume,
  previewListingFingerprint,
} from "@/lib/preview-packs/resume";

describe("preview pack resume plan", () => {
  it("reads the identity key from a preview Cloudinary public id", () => {
    const publicId = previewImagePublicId("athol-garage", "source-99", "attempt-1", 2);
    expect(identityKeyFromPreviewPublicId(publicId, "athol-garage")).toBe("source-99");
    expect(identityKeyFromPreviewPublicId(publicId, "mikes-motors")).toBeNull();
  });

  it("creates missing vehicles, backfills listings with no photos, and skips complete ones", () => {
    const completePublicId = previewImagePublicId(
      "athol-garage",
      "car-complete",
      "attempt-1",
      0,
    );
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
          photoRevision: 2,
          images: [],
        },
        {
          id: "listing-complete",
          title: "2019 Audi A3",
          pricePence: 3_000_000,
          mileage: "20000",
          photoRevision: 4,
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
        expectedPhotoRevision: 2,
        expectedPublicIds: [],
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

  it("prioritizes exact identities globally regardless of source order", () => {
    const exactImage = previewImagePublicId("athol-garage", "exact-car", "attempt-1", 0);
    const weak = {
      identityKey: "weak-car",
      title: "Original title",
      pricePence: 1_000_000,
      mileage: "10000",
      sourceCount: 1,
    };
    const exact = {
      identityKey: "exact-car",
      title: "Updated title",
      pricePence: 1_100_000,
      mileage: "9000",
      sourceCount: 1,
    };
    const listings = [{
      id: "listing-1",
      title: weak.title,
      pricePence: weak.pricePence,
      mileage: weak.mileage,
      photoRevision: 1,
      images: [{ publicId: exactImage, order: 0 }],
    }];
    for (const vehicles of [[weak, exact], [exact, weak]]) {
      const plan = planPreviewPackResume({
        dealerKey: "athol-garage",
        vehicles,
        listings,
      });
      expect(plan.find((action) => action.identityKey === "exact-car")).toEqual({
        kind: "complete",
        identityKey: "exact-car",
        listingId: "listing-1",
      });
      expect(plan.find((action) => action.identityKey === "weak-car")).toEqual({
        kind: "create",
        identityKey: "weak-car",
      });
    }
  });
});

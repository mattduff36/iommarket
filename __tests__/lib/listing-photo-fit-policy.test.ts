import { describe, expect, it } from "vitest";
import { getListingPhotoFitMode, getRetainedVisibleFraction } from "@/lib/images/fit-policy";

describe("PHOTO-FIT-001 listing photo fit policy", () => {
  it("crops when the retained visible fraction is exactly 80%", () => {
    expect(getRetainedVisibleFraction(8, 10, 10, 10)).toBe(0.8);
    expect(
      getListingPhotoFitMode({
        sourceWidth: 8,
        sourceHeight: 10,
        frameWidth: 10,
        frameHeight: 10,
      }),
    ).toBe("crop");
  });

  it("pads when the retained visible fraction is just below 80%", () => {
    expect(getListingPhotoFitMode({
      sourceWidth: 79,
      sourceHeight: 100,
      frameWidth: 100,
      frameHeight: 100,
    })).toBe("pad");
  });

  it("crops near-match landscape photos into 4:3 cards", () => {
    expect(
      getListingPhotoFitMode({
        sourceWidth: 1600,
        sourceHeight: 1000,
        frameWidth: 4,
        frameHeight: 3,
      }),
    ).toBe("crop");
  });

  it("pads portrait photos in landscape frames", () => {
    expect(
      getListingPhotoFitMode({
        sourceWidth: 900,
        sourceHeight: 1600,
        frameWidth: 16,
        frameHeight: 10,
      }),
    ).toBe("pad");
  });

  it("pads when metadata is missing or invalid", () => {
    expect(
      getListingPhotoFitMode({
        sourceWidth: null,
        sourceHeight: null,
        frameWidth: 16,
        frameHeight: 10,
      }),
    ).toBe("pad");
    expect(
      getListingPhotoFitMode({
        sourceWidth: 0,
        sourceHeight: 1000,
        frameWidth: 16,
        frameHeight: 10,
      }),
    ).toBe("pad");
  });
});

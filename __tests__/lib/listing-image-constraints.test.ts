import { describe, expect, it } from "vitest";
import {
  isAllowedListingImageFormat,
  validateListingImageBounds,
} from "@/lib/images/constraints";

describe("PHOTO-UPLOAD-001 listing image constraints", () => {
  it("accepts jpg, png, webp, heic and heif", () => {
    expect(isAllowedListingImageFormat("jpg")).toBe(true);
    expect(isAllowedListingImageFormat("JPEG")).toBe(true);
    expect(isAllowedListingImageFormat("png")).toBe(true);
    expect(isAllowedListingImageFormat("webp")).toBe(true);
    expect(isAllowedListingImageFormat("heic")).toBe(true);
    expect(isAllowedListingImageFormat("heif")).toBe(true);
    expect(isAllowedListingImageFormat("gif")).toBe(false);
  });

  it("enforces the 10MB, edge and 50MP limits", () => {
    expect(validateListingImageBounds({ width: 1600, height: 1000, bytes: 2_000_000 })).toBeNull();
    expect(validateListingImageBounds({ width: 1600, height: 1000, bytes: 10 * 1024 * 1024 + 1 })).toMatch(/10MB/i);
    expect(validateListingImageBounds({ width: 799, height: 480, bytes: 1000 })).toMatch(/800/);
    expect(validateListingImageBounds({ width: 800, height: 479, bytes: 1000 })).toMatch(/480/);
    expect(validateListingImageBounds({ width: 10000, height: 5001, bytes: 1000 })).toMatch(/megapixel/i);
  });
});

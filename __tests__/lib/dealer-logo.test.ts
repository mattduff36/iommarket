import { describe, expect, it } from "vitest";
import {
  DEALER_LOGO_MAX_FILE_SIZE_BYTES,
  getOwnedDealerLogoStoragePath,
  validateDealerLogoFile,
} from "@/lib/upload/dealer-logo";

function createPngFile(name = "logo.png", size = 12) {
  const pngHeader = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const bytes = new Uint8Array([...pngHeader, ...new Uint8Array(size)]);
  return {
    name,
    size: bytes.byteLength,
    type: "image/png",
    arrayBuffer: async () => bytes.buffer,
  };
}

describe("validateDealerLogoFile", () => {
  it("accepts a PNG logo with a matching MIME type and file signature", async () => {
    await expect(validateDealerLogoFile(createPngFile())).resolves.toMatchObject({
      data: {
        extension: "png",
        mimeType: "image/png",
      },
    });
  });

  it("rejects a file with a disallowed type", async () => {
    const file = {
      name: "logo.svg",
      size: 12,
      type: "image/svg+xml",
      arrayBuffer: async () => new ArrayBuffer(12),
    };

    await expect(validateDealerLogoFile(file)).resolves.toEqual({
      error: "Upload a PNG, JPG, GIF, or WebP image.",
    });
  });

  it("rejects a file larger than the logo limit", async () => {
    const file = {
      name: "logo.png",
      size: DEALER_LOGO_MAX_FILE_SIZE_BYTES + 1,
      type: "image/png",
      arrayBuffer: async () => new ArrayBuffer(0),
    };

    await expect(validateDealerLogoFile(file)).resolves.toEqual({
      error: "Logo images must be 5 MB or smaller.",
    });
  });
});

describe("getOwnedDealerLogoStoragePath", () => {
  const supabaseUrl = "https://project.supabase.co";
  const authUserId = "11111111-1111-1111-1111-111111111111";
  const dealerId = "cmdealerprofile123";

  it("returns only the authenticated dealer's namespaced object path", () => {
    const storageUrl =
      "https://project.supabase.co/storage/v1/object/public/user-avatars/" +
      `${authUserId}/dealer-logos/${dealerId}/123e4567-e89b-12d3-a456-426614174000.webp`;

    expect(
      getOwnedDealerLogoStoragePath({
        logoUrl: storageUrl,
        supabaseUrl,
        authUserId,
        dealerId,
      }),
    ).toBe(
      `${authUserId}/dealer-logos/${dealerId}/123e4567-e89b-12d3-a456-426614174000.webp`,
    );
  });

  it("denies a logo path belonging to another account", () => {
    const storageUrl =
      "https://project.supabase.co/storage/v1/object/public/user-avatars/" +
      "22222222-2222-2222-2222-222222222222/dealer-logos/cmdealerprofile123/logo.webp";

    expect(
      getOwnedDealerLogoStoragePath({
        logoUrl: storageUrl,
        supabaseUrl,
        authUserId,
        dealerId,
      }),
    ).toBeNull();
  });

  it("does not treat historical external URLs as deletable storage objects", () => {
    expect(
      getOwnedDealerLogoStoragePath({
        logoUrl: "https://example.com/legacy-logo.png",
        supabaseUrl,
        authUserId,
        dealerId,
      }),
    ).toBeNull();
  });
});

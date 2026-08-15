import { describe, expect, it, vi } from "vitest";
import { applyRevisionImages } from "@/lib/listings/revision-photos";

describe("revision photo apply ALR-PHOTO-001 ALR-PHOTO-002", () => {
  it("matches live images by provider and publicId and never copies uploadIntentId", async () => {
    const client = {
      listingImage: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "live-1",
            provider: "CLOUDINARY",
            publicId: "keep",
            order: 0,
            uploadIntentId: "intent-live",
          },
          {
            id: "live-2",
            provider: "CLOUDINARY",
            publicId: "drop",
            order: 1,
            uploadIntentId: "intent-old",
          },
        ]),
        update: vi.fn(),
        delete: vi.fn(),
        create: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
      },
      listingRevisionImage: {
        findMany: vi.fn().mockResolvedValue([
          {
            provider: "CLOUDINARY",
            publicId: "keep",
            order: 0,
            url: "https://img/keep",
            assetId: "a",
            version: "1",
            width: 800,
            height: 600,
            format: "jpg",
            bytes: 10,
            focalX: 0.5,
            focalY: 0.5,
            uploadIntentId: "intent-rev",
          },
          {
            provider: "CLOUDINARY",
            publicId: "new",
            order: 1,
            url: "https://img/new",
            assetId: "b",
            version: "1",
            width: 800,
            height: 600,
            format: "jpg",
            bytes: 10,
            focalX: null,
            focalY: null,
            uploadIntentId: "intent-new",
          },
        ]),
        count: vi.fn().mockResolvedValue(0),
      },
      listingImageCleanupJob: { create: vi.fn() },
    };

    await applyRevisionImages(client as never, "listing-1", "rev-1");

    expect(client.listingImage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          publicId: "new",
          uploadIntentId: null,
        }),
      }),
    );
    expect(client.listingImage.delete).toHaveBeenCalledWith({
      where: { id: "live-2" },
    });
  });
});

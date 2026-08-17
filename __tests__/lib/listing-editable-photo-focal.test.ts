import { beforeEach, describe, expect, it, vi } from "vitest";

const { listingFindFirst, getOpenRevision, getOrCreateDraftRevision } = vi.hoisted(() => ({
  listingFindFirst: vi.fn(),
  getOpenRevision: vi.fn(),
  getOrCreateDraftRevision: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    listing: {
      findFirst: listingFindFirst,
    },
  },
}));

vi.mock("@/lib/listings/revisions", () => ({
  getOpenRevision,
  getOrCreateDraftRevision,
}));

import { getEditableDraft } from "@/lib/listings/editable-draft";

const image = {
  id: "image-1",
  url: "https://example.com/photo.jpg",
  publicId: "demo/photo",
  order: 0,
  provider: "EXTERNAL",
  assetId: null,
  version: null,
  width: 1600,
  height: 1000,
  format: "jpg",
  bytes: 123,
  uploadIntentId: null,
  focalX: 0.23,
  focalY: 0.71,
};

function listing(status: "DRAFT" | "LIVE" | "REJECTED" | "TAKEN_DOWN") {
  return {
    id: "listing-1",
    userId: "user-1",
    dealerId: null,
    title: "Focused listing",
    description: "Description long enough for an editable listing.",
    price: 1_000_00,
    categoryId: "category-1",
    regionId: "region-1",
    trustDeclarationAccepted: true,
    featured: false,
    photoRevision: 4,
    status,
    images: [image],
    attributeValues: [],
  };
}

describe("listing edit focal persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps focal coordinates when an in-place draft is reopened", async () => {
    listingFindFirst.mockResolvedValue(listing("DRAFT"));

    const draft = await getEditableDraft({
      draftId: "listing-1",
      userId: "user-1",
      dealerId: null,
    });

    expect(draft?.images[0]).toMatchObject({ focalX: 0.23, focalY: 0.71, order: 0 });
  });

  it.each([
    ["DRAFT", "draft"],
    ["REJECTED", "resubmit"],
    ["TAKEN_DOWN", "resubmit"],
  ] as const)(
    "reopens %s content in the correct editable flow",
    async (status, editMode) => {
      listingFindFirst.mockResolvedValue({
        ...listing(status),
        attributeValues: [
          { attributeDefinitionId: "attribute-1", value: "value-1" },
        ],
      });

      const draft = await getEditableDraft({
        draftId: "listing-1",
        userId: "user-1",
        dealerId: null,
      });

      expect(draft).toMatchObject({
        editMode,
        trustDeclarationAccepted: true,
        photoRevision: 4,
        images: [{ focalX: 0.23, focalY: 0.71 }],
        attributes: [
          { attributeDefinitionId: "attribute-1", value: "value-1" },
        ],
      });
    },
  );

  it("keeps focal coordinates from a moderated revision", async () => {
    listingFindFirst.mockResolvedValue(listing("LIVE"));
    getOpenRevision.mockResolvedValue({
      id: "revision-1",
      title: "Focused revision",
      description: "Description long enough for a moderated revision.",
      price: 1_000_00,
      categoryId: "category-1",
      regionId: "region-1",
      trustDeclarationAccepted: true,
      status: "DRAFT",
      version: 7,
      images: [{ ...image, focalX: 0.41, focalY: 0.62 }],
      attributeValues: [],
    });

    const draft = await getEditableDraft({
      draftId: "listing-1",
      userId: "user-1",
      dealerId: null,
    });

    expect(draft).toMatchObject({
      editMode: "revision",
      photoRevision: 7,
      images: [{ focalX: 0.41, focalY: 0.62 }],
    });
    expect(getOrCreateDraftRevision).not.toHaveBeenCalled();
  });
});

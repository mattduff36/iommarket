import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique } = vi.hoisted(() => ({
  findUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    dealerCorrespondenceSettings: {
      findUnique,
    },
  },
}));

import { resolveDealerMailRecipients } from "@/lib/dealers/correspondence-routing";

describe("dealer correspondence routing lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not query settings for a private seller", async () => {
    await expect(
      resolveDealerMailRecipients({
        dealerId: null,
        primaryEmail: "seller@example.com",
        category: "BUYER_ENQUIRIES",
      }),
    ).resolves.toEqual(["seller@example.com"]);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("ignores an unverified pending address", async () => {
    findUnique.mockResolvedValue({
      verifiedEmail: null,
      categories: ["LISTING_UPDATES"],
      copyAssignedToPrimary: false,
    });

    await expect(
      resolveDealerMailRecipients({
        dealerId: "dealer-1",
        primaryEmail: "owner@dealer.example",
        category: "LISTING_UPDATES",
      }),
    ).resolves.toEqual(["owner@dealer.example"]);
  });

  it("falls back to the login address when settings cannot be read", async () => {
    findUnique.mockRejectedValue(new Error("database unavailable"));

    await expect(
      resolveDealerMailRecipients({
        dealerId: "dealer-1",
        primaryEmail: "owner@dealer.example",
        category: "REVIEWS",
      }),
    ).resolves.toEqual(["owner@dealer.example"]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, enabled } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  enabled: vi.fn(),
}));

vi.mock("@/lib/notifications/settings", () => ({ isNotificationEnabled: enabled }));

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
    enabled.mockResolvedValue(true);
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

  it("suppresses all routed listing recipients when opted out", async () => {
    enabled.mockResolvedValue(false);
    await expect(resolveDealerMailRecipients({ dealerId: "dealer-1", primaryEmail: "owner@example.com", category: "LISTING_UPDATES" })).resolves.toEqual([]);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("routes draft notifications independently of ordinary listing updates", async () => {
    enabled.mockImplementation(async (key: string) => key === "draftListings");
    findUnique.mockResolvedValue(null);
    await expect(resolveDealerMailRecipients({ dealerId: "dealer-1", primaryEmail: "owner@example.com", category: "LISTING_UPDATES", notificationPreference: "draftListings" })).resolves.toEqual(["owner@example.com"]);
    await expect(resolveDealerMailRecipients({ dealerId: "dealer-1", primaryEmail: "owner@example.com", category: "LISTING_UPDATES" })).resolves.toEqual([]);
  });

  it("keeps buyer enquiries mandatory even with optional emails off", async () => {
    enabled.mockResolvedValue(false);
    await expect(resolveDealerMailRecipients({ primaryEmail: "buyer@example.com", category: "BUYER_ENQUIRIES" })).resolves.toEqual(["buyer@example.com"]);
    expect(enabled).not.toHaveBeenCalled();
  });

  it("does not bypass optout when preferences cannot be read", async () => {
    enabled.mockRejectedValue(new Error("unavailable"));
    await expect(resolveDealerMailRecipients({ primaryEmail: "owner@example.com", category: "LISTING_UPDATES" })).resolves.toEqual([]);
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

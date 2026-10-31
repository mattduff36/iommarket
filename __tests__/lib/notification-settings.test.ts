import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateNotificationSettings } from "@/actions/account-notifications";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  visiblePreferenceKeys,
} from "@/lib/notifications/preferences";
import { isNotificationEnabled, readNotificationPreferences } from "@/lib/notifications/settings";

const { requireAcceptedUserMock, resolveTradeActorMock, findUnique, findFirst, upsert } = vi.hoisted(() => ({
  requireAcceptedUserMock: vi.fn(),
  resolveTradeActorMock: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/lib/policy/gate", () => ({
  requireAcceptedUser: requireAcceptedUserMock,
}));

vi.mock("@/lib/trade-exchange/access", () => ({
  resolveTradeActor: resolveTradeActorMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    userNotificationSettings: {
      findUnique,
      upsert,
    },
    user: {
      findFirst,
    },
  },
}));

const initialNotificationSettingsState = { status: "idle" as const, message: "" };

const storedOff = {
  listingUpdates: false,
  dealerReviews: true,
  tradeMessages: true,
  tradeListingUpdates: true,
  tradeSavedSearchAlerts: true,
};

function accountUser(role: "USER" | "DEALER" | "ADMIN") {
  return {
    id: "actor-1",
    role,
    email: "actor@example.com",
    disabledAt: null,
    deletedAt: null,
    dealerProfile:
      role === "DEALER" ? { id: "dealer-1", name: "Island Motors", tier: "PRO" as const } : null,
  };
}

describe("notification preference defaults", () => {
  beforeEach(() => {
    findUnique.mockReset();
    findFirst.mockReset();
    upsert.mockReset();
  });

  it("keeps every category on when the preference row is absent", async () => {
    findUnique.mockResolvedValue(null);

    await expect(readNotificationPreferences("actor-1")).resolves.toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    await expect(isNotificationEnabled("listingUpdates", { userId: "actor-1" })).resolves.toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFERENCES).toEqual({
      listingUpdates: true,
      draftListings: true,
      dealerReviews: true,
      tradeMessages: true,
      tradeListingUpdates: true,
      tradeSavedSearchAlerts: true,
    });
  });

  it("returns the stored choice and throws when the lookup fails", async () => {
    findUnique.mockResolvedValueOnce(storedOff);
    await expect(isNotificationEnabled("listingUpdates", { userId: "actor-1" })).resolves.toBe(false);

    findFirst.mockResolvedValueOnce(null);
    await expect(
      isNotificationEnabled("dealerReviews", { email: "missing@example.com" }),
    ).resolves.toBe(true);

    findFirst.mockResolvedValueOnce({ id: "actor-1" });
    findUnique.mockResolvedValueOnce(storedOff);
    await expect(
      isNotificationEnabled("listingUpdates", { email: "Actor@Example.com" }),
    ).resolves.toBe(false);

    findUnique.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(isNotificationEnabled("listingUpdates", { userId: "actor-1" })).rejects.toThrow(
      "database unavailable",
    );

    findFirst.mockRejectedValueOnce(new Error("email lookup failed"));
    await expect(
      isNotificationEnabled("tradeMessages", { email: "actor@example.com" }),
    ).rejects.toThrow("email lookup failed");
  });

  it("uses the supplied user id instead of the email", async () => {
    findUnique.mockResolvedValue(storedOff);

    await expect(
      isNotificationEnabled("listingUpdates", { userId: "actor-1", email: "other@example.com" }),
    ).resolves.toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe("notification preference authorization", () => {
  beforeEach(() => {
    requireAcceptedUserMock.mockReset();
    resolveTradeActorMock.mockReset();
    upsert.mockReset();
    upsert.mockResolvedValue({ id: "settings-1" });
  });

  it("shows listing updates to everyone, reviews to dealers, and trade options to eligible members", () => {
    expect(visiblePreferenceKeys({ role: "USER", tradeEligible: false })).toEqual(["listingUpdates", "draftListings"]);
    expect(visiblePreferenceKeys({ role: "ADMIN", tradeEligible: false })).toEqual(["listingUpdates", "draftListings"]);
    expect(visiblePreferenceKeys({ role: "DEALER", tradeEligible: false })).toEqual([
      "listingUpdates",
      "draftListings",
      "dealerReviews",
    ]);
    expect(visiblePreferenceKeys({ role: "DEALER", tradeEligible: true })).toEqual([
      "listingUpdates",
      "draftListings",
      "dealerReviews",
      "tradeMessages",
      "tradeListingUpdates",
      "tradeSavedSearchAlerts",
    ]);
  });

  it("rejects another user id and does not write", async () => {
    requireAcceptedUserMock.mockResolvedValue(accountUser("USER"));
    resolveTradeActorMock.mockResolvedValue({ kind: "denied" });
    const formData = new FormData();
    formData.set("userId", "other-user");
    formData.set("listingUpdates", "false");

    const result = await updateNotificationSettings(initialNotificationSettingsState, formData);

    expect(result.status).toBe("error");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("saves draft opt-out without resetting other notification preferences", async () => {
    requireAcceptedUserMock.mockResolvedValue(accountUser("DEALER"));
    resolveTradeActorMock.mockResolvedValue({kind: "denied"});
    const form = new FormData();
    form.set("draftListings", "false");
    expect((await updateNotificationSettings(initialNotificationSettingsState, form)).status).toBe("success");
    expect(upsert).toHaveBeenCalledWith({where:{userId:"actor-1"},create:{userId:"actor-1",draftListings:false},update:{draftListings:false}});
  });

  it("rejects hidden preference fields instead of resetting them", async () => {
    requireAcceptedUserMock.mockResolvedValue(accountUser("USER"));
    resolveTradeActorMock.mockResolvedValue({ kind: "denied" });
    const formData = new FormData();
    formData.set("listingUpdates", "false");
    formData.set("dealerReviews", "false");
    formData.set("tradeSavedSearchAlerts", "false");

    const result = await updateNotificationSettings(initialNotificationSettingsState, formData);

    expect(result).toMatchObject({
      status: "error",
      message: "Those notification settings are not available for this account.",
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("persists only the signed-in member's authorized fields", async () => {
    requireAcceptedUserMock.mockResolvedValue(accountUser("DEALER"));
    resolveTradeActorMock.mockResolvedValue({ kind: "member", userId: "actor-1", dealerId: "dealer-1" });
    const formData = new FormData();
    formData.set("listingUpdates", "false");
    formData.set("dealerReviews", "true");
    formData.set("tradeMessages", "false");
    formData.set("tradeListingUpdates", "true");
    formData.set("tradeSavedSearchAlerts", "false");

    const result = await updateNotificationSettings(initialNotificationSettingsState, formData);

    expect(result).toEqual({
      status: "success",
      message: "Your notification preferences have been saved.",
    });
    expect(upsert).toHaveBeenCalledWith({
      where: { userId: "actor-1" },
      create: {
        userId: "actor-1",
        listingUpdates: false,
        dealerReviews: true,
        tradeMessages: false,
        tradeListingUpdates: true,
        tradeSavedSearchAlerts: false,
      },
      update: {
        listingUpdates: false,
        dealerReviews: true,
        tradeMessages: false,
        tradeListingUpdates: true,
        tradeSavedSearchAlerts: false,
      },
    });
  });
});

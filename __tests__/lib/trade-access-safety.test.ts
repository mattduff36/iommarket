import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TradeActor } from "@/lib/trade-exchange/decision";

const findMany = vi.hoisted(() => vi.fn());
const count = vi.hoisted(() => vi.fn());
const listingFindUnique = vi.hoisted(() => vi.fn());
const imageFindUnique = vi.hoisted(() => vi.fn());
const eligibleIds = vi.hoisted(() => vi.fn());
const sellerEligible = vi.hoisted(() => vi.fn());
const getDetails = vi.hoisted(() => vi.fn());
const assertAllowed = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: {
    tradeListing: { findMany, count, findUnique: listingFindUnique },
    tradeListingImage: { findUnique: imageFindUnique },
  },
}));

vi.mock("@/lib/trade-exchange/access", () => ({
  listEligibleTradeDealerIds: eligibleIds,
  sellerIsEligible: sellerEligible,
}));

vi.mock("@/lib/trade-exchange/limits", () => ({
  tradeRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/trade-exchange/notify", () => ({
  notifyTradeEnquiry: vi.fn(),
}));

vi.mock("@/lib/media/imagekit-api", () => ({
  getImageKitFileDetails: getDetails,
  signedImageKitDeliveryUrl: vi.fn(),
  uploadPrivateImageKitFile: vi.fn(),
}));

vi.mock("@/lib/database-sync/effects", () => ({
  assertExternalEffectAllowed: assertAllowed,
}));

import { canViewTradeListing } from "@/lib/trade-exchange/decision";
import { sendTradeEnquiry } from "@/lib/trade-exchange/enquiries";
import { readAuthorizedTradePhoto } from "@/lib/trade-exchange/images";
import { getVisibleTradeListing, searchLiveTradeListings } from "@/lib/trade-exchange/listings";
import { deleteTradeFile } from "@/lib/trade-exchange/storage";

const now = new Date("2026-10-15T12:00:00.000Z");
const future = new Date("2026-11-15T12:00:00.000Z");
const past = new Date("2026-09-15T12:00:00.000Z");
const other: TradeActor = { kind: "member", userId: "user-2", dealerId: "dealer-2", dealerName: "Other Motors" };
const owner: TradeActor = { kind: "member", userId: "user-1", dealerId: "dealer-1", dealerName: "Harbour Motors" };
const admin: TradeActor = { kind: "admin", userId: "admin-1" };
const fileId = "file_trade_1";
const filePath = "/iommarket-trade-private/local/listings/dealer1/listing1/photo.jpg";
const storageEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  IMAGEKIT_PRIVATE_KEY: "unit-test-key",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/iommarket",
};

function matchedFile(overrides: Record<string, unknown> = {}) {
  return {
    fileId,
    filePath,
    size: 10,
    width: 1,
    height: 1,
    fileType: "image",
    isPrivateFile: true,
    ...overrides,
  };
}

describe("trade access safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockRejectedValue(new Error("unexpected provider call"));
    vi.stubGlobal("fetch", fetchMock);
    eligibleIds.mockResolvedValue(["dealer-ok"]);
    sellerEligible.mockResolvedValue(true);
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);
    assertAllowed.mockResolvedValue(undefined);
  });

  it("keeps a dealer filter from replacing the eligible seller list", async () => {
    const result = await searchLiveTradeListings(other, { dealerId: "dealer-evil" });
    expect(result).toMatchObject({ ok: true });
    const where = findMany.mock.calls[0]?.[0]?.where;
    expect(where.dealerId).toBeUndefined();
    expect(where.AND[0]).toMatchObject({ status: "LIVE", dealerId: { in: ["dealer-ok"] } });
    expect(where.AND[0].expiresAt.gt).toBeInstanceOf(Date);
    expect(where.AND[1]).toMatchObject({ dealerId: "dealer-evil" });
    expect(count.mock.calls[0]?.[0]?.where).toEqual(where);
  });

  it("denies other dealers an expired listing, photo, or enquiry and keeps owner and admin access", async () => {
    expect(canViewTradeListing({ actor: other, listingDealerId: "dealer-1", status: "LIVE", sellerEligible: true, expiresAt: past, now })).toBe(false);
    expect(canViewTradeListing({ actor: other, listingDealerId: "dealer-1", status: "LIVE", sellerEligible: true, now })).toBe(false);
    expect(canViewTradeListing({ actor: other, listingDealerId: "dealer-1", status: "LIVE", sellerEligible: true, expiresAt: future, now })).toBe(true);
    expect(canViewTradeListing({ actor: owner, listingDealerId: "dealer-1", status: "LIVE", sellerEligible: true, expiresAt: past, now })).toBe(true);
    expect(canViewTradeListing({ actor: admin, listingDealerId: "dealer-1", status: "EXPIRED", sellerEligible: false, expiresAt: past, now })).toBe(true);

    listingFindUnique.mockResolvedValue({ id: "listing-1", dealerId: "dealer-1", status: "LIVE", expiresAt: past });
    expect(await getVisibleTradeListing(other, "listing-1", now)).toBeNull();
    expect(await getVisibleTradeListing(owner, "listing-1", now)).toMatchObject({ id: "listing-1" });

    imageFindUnique.mockResolvedValue({
      filePath,
      contentType: "image/jpeg",
      listing: { dealerId: "dealer-1", status: "LIVE", expiresAt: past },
    });
    expect(await readAuthorizedTradePhoto(other, "image-1")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    listingFindUnique.mockResolvedValue({
      id: "listing-1",
      dealerId: "dealer-1",
      status: "LIVE",
      expiresAt: past,
      dealer: { user: { email: "seller@example.com" } },
    });
    await expect(sendTradeEnquiry(other, { listingId: "listing-1", body: "Is this still available?" })).resolves.toEqual({ error: "Not found." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a provider delete when file metadata or the protected-reference check fails", async () => {
    getDetails.mockResolvedValue(matchedFile({ filePath: "/public/other.jpg", isPrivateFile: true }));
    await expect(deleteTradeFile(fileId, filePath, storageEnv)).rejects.toThrow(/not available/);
    expect(assertAllowed).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    getDetails.mockResolvedValue(matchedFile({ isPrivateFile: false }));
    await expect(deleteTradeFile(fileId, filePath, storageEnv)).rejects.toThrow(/not available/);

    getDetails.mockResolvedValue(matchedFile({ fileId: "file_other" }));
    await expect(deleteTradeFile(fileId, filePath, storageEnv)).rejects.toThrow(/not available/);

    getDetails.mockRejectedValue(new Error("lookup failed"));
    await expect(deleteTradeFile(fileId, filePath, storageEnv)).rejects.toThrow(/not available/);

    getDetails.mockResolvedValue(null);
    await expect(deleteTradeFile(fileId, filePath, storageEnv)).rejects.toThrow(/not available/);

    getDetails.mockResolvedValue(matchedFile());
    assertAllowed.mockRejectedValue(new Error("protected media reference"));
    await expect(deleteTradeFile(fileId, filePath, storageEnv)).rejects.toThrow(/protected media reference/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deletes only after the provider file matches and protected references are allowed", async () => {
    getDetails.mockResolvedValue(matchedFile());
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await deleteTradeFile(fileId, filePath, storageEnv);
    expect(getDetails).toHaveBeenCalledWith({ fileId, env: storageEnv });
    expect(assertAllowed).toHaveBeenCalledWith({ mediaIds: [fileId, filePath] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`https://api.imagekit.io/v1/files/${encodeURIComponent(fileId)}`);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
    expect(assertAllowed.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
  });
});

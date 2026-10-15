import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TradeActor } from "@/lib/trade-exchange/decision";

const h = vi.hoisted(() => {
  const executeRaw = vi.fn();
  const listingFindUnique = vi.fn();
  const listingFindMany = vi.fn();
  const listingUpdate = vi.fn();
  const listingUpdateMany = vi.fn();
  const listingCount = vi.fn();
  const listingEventCreate = vi.fn();
  const imageFindUnique = vi.fn();
  const imageCreate = vi.fn();
  const imageDeleteMany = vi.fn();
  const imageCount = vi.fn();
  const enquiryFindUnique = vi.fn();
  const enquiryCreate = vi.fn();
  const enquiryUpdateMany = vi.fn();
  const enquiryCount = vi.fn();
  const messageCreate = vi.fn();
  const metricCreate = vi.fn();
  const auditCreate = vi.fn();
  const reportCreate = vi.fn();
  const reportFindUnique = vi.fn();
  const reportUpdateMany = vi.fn();
  const savedCount = vi.fn();
  const savedCreate = vi.fn();
  const savedFindMany = vi.fn();
  const savedUpdate = vi.fn();
  const db = {
    $executeRaw: executeRaw,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(db)),
    tradeListing: {
      findUnique: listingFindUnique,
      findMany: listingFindMany,
      update: listingUpdate,
      updateMany: listingUpdateMany,
      count: listingCount,
    },
    tradeListingEvent: { create: listingEventCreate },
    tradeListingImage: {
      findUnique: imageFindUnique,
      create: imageCreate,
      deleteMany: imageDeleteMany,
      count: imageCount,
    },
    tradeEnquiry: {
      findUnique: enquiryFindUnique,
      create: enquiryCreate,
      updateMany: enquiryUpdateMany,
      count: enquiryCount,
    },
    tradeMessage: { create: messageCreate },
    tradeMetricEvent: { create: metricCreate },
    tradeReport: { create: reportCreate, findUnique: reportFindUnique, updateMany: reportUpdateMany },
    tradeSavedSearch: { count: savedCount, create: savedCreate, findMany: savedFindMany, update: savedUpdate },
    adminAuditLog: { create: auditCreate },
  };
  return {
    db,
    executeRaw,
    listingFindUnique,
    listingFindMany,
    listingUpdate,
    listingUpdateMany,
    listingCount,
    listingEventCreate,
    imageFindUnique,
    imageCreate,
    imageDeleteMany,
    imageCount,
    enquiryFindUnique,
    enquiryCreate,
    enquiryUpdateMany,
    enquiryCount,
    messageCreate,
    metricCreate,
    auditCreate,
    reportCreate,
    reportFindUnique,
    reportUpdateMany,
    savedCount,
    savedCreate,
    savedFindMany,
    savedUpdate,
    enabled: vi.fn(),
    eligibleIds: vi.fn(),
    sellerEligible: vi.fn(),
    sendEmail: vi.fn(),
    storeFile: vi.fn(),
    deleteFile: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/trade-exchange/flag", () => ({ isTradeExchangeEnabled: h.enabled }));
vi.mock("@/lib/trade-exchange/access", () => ({
  listEligibleTradeDealerIds: h.eligibleIds,
  sellerIsEligible: h.sellerEligible,
}));
vi.mock("@/lib/trade-exchange/limits", () => ({ tradeRateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/email/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/client")>();
  return { ...actual, sendResendEmail: h.sendEmail };
});
vi.mock("@/lib/trade-exchange/storage", () => ({
  storeTradeFile: h.storeFile,
  deleteTradeFile: h.deleteFile,
  readTradeFile: vi.fn(),
}));

import { sendTradeEnquiry, replyToTradeEnquiry, changeTradeEnquiryStatus } from "@/lib/trade-exchange/enquiries";
import { addTradePhoto, removeTradePhoto } from "@/lib/trade-exchange/images";
import { updateTradeListing, changeTradeListingStatus } from "@/lib/trade-exchange/listings";
import { maintainTradeExchange, tradeStockSummary } from "@/lib/trade-exchange/maintenance";
import { notifyTradeSavedSearch } from "@/lib/trade-exchange/notify";
import { reportTradeListing, resolveTradeReport } from "@/lib/trade-exchange/reports";
import { saveTradeSearch } from "@/lib/trade-exchange/saved-searches";

const now = new Date("2026-10-15T12:00:00.000Z");
const future = new Date("2026-11-15T12:00:00.000Z");
const past = new Date("2026-09-15T12:00:00.000Z");
const soon = new Date("2026-10-16T12:00:00.000Z");
const admin: TradeActor = { kind: "admin", userId: "admin-1" };
const owner: TradeActor = { kind: "member", userId: "user-1", dealerId: "dealer-1", dealerName: "Harbour Motors" };
const buyer: TradeActor = { kind: "member", userId: "user-2", dealerId: "dealer-2", dealerName: "Other Motors" };
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const listingInput = {
  make: "Ford",
  model: "Focus",
  year: 2019,
  mileage: 30000,
  transmission: "Manual",
  fuel: "Petrol",
  conditionSummary: "Good",
  disclosedDefects: "None known",
  priceType: "POA",
  vatTreatment: "NO_VAT",
  locationLabel: "Douglas",
  contactPreference: "MESSAGE",
  ownershipDeclared: true,
  authorityDeclared: true,
  mileageDeclared: true,
  conditionDeclared: true,
  notWrittenOffDeclared: true,
  writeOff: "NONE",
};

function publishable(status: string) {
  return {
    id: "listing-1",
    dealerId: "dealer-1",
    status,
    make: "Ford",
    model: "Focus",
    year: 2019,
    mileage: 30000,
    transmission: "Manual",
    fuel: "Petrol",
    conditionSummary: "Good",
    disclosedDefects: "None known",
    serviceHistory: null,
    motStatus: null,
    priceType: "FIXED",
    pricePence: 500000,
    vatTreatment: "NO_VAT",
    registrationNumber: null,
    vin: null,
    locationLabel: "Douglas",
    notes: null,
    contactPreference: "MESSAGE",
    availabilityNote: null,
    ownershipDeclared: true,
    authorityDeclared: true,
    mileageDeclared: true,
    conditionDeclared: true,
    notWrittenOffDeclared: true,
    images: [{ id: "image-1" }],
  };
}

function liveListing(expiresAt: Date = future) {
  return {
    id: "listing-1",
    dealerId: "dealer-1",
    status: "LIVE" as const,
    expiresAt,
    dealer: { user: { email: "seller@example.com" } },
  };
}

function lockCalls() {
  return h.executeRaw.mock.calls.map((call) => ({
    sql: Array.isArray(call[0]) ? call[0].join("") : "",
    key: call[1] as string,
  }));
}

describe("trade workflow integrity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of [
      h.executeRaw, h.listingFindUnique, h.listingFindMany, h.listingUpdate, h.listingUpdateMany,
      h.listingCount, h.listingEventCreate, h.imageFindUnique, h.imageCreate, h.imageDeleteMany,
      h.imageCount, h.enquiryFindUnique, h.enquiryCreate, h.enquiryUpdateMany, h.enquiryCount,
      h.messageCreate, h.metricCreate, h.auditCreate, h.reportCreate, h.reportFindUnique,
      h.reportUpdateMany, h.savedCount, h.savedCreate, h.savedFindMany, h.savedUpdate,
      h.enabled, h.eligibleIds, h.sellerEligible, h.sendEmail, h.storeFile, h.deleteFile,
    ]) fn.mockReset();
    h.db.$transaction.mockImplementation(async (callback: (tx: typeof h.db) => Promise<unknown>) => callback(h.db));
    h.enabled.mockReturnValue(true);
    h.eligibleIds.mockResolvedValue(["dealer-1", "dealer-2"]);
    h.sellerEligible.mockResolvedValue(true);
    h.sendEmail.mockResolvedValue(undefined);
    h.storeFile.mockResolvedValue({ fileId: "file-new", filePath: "/new.jpg", width: 8, height: 8, size: 4 });
    h.deleteFile.mockResolvedValue(undefined);
    h.listingUpdateMany.mockResolvedValue({ count: 1 });
    h.enquiryUpdateMany.mockResolvedValue({ count: 1 });
    h.reportUpdateMany.mockResolvedValue({ count: 1 });
    h.imageDeleteMany.mockResolvedValue({ count: 1 });
    h.listingCount.mockResolvedValue(0);
    h.imageCount.mockResolvedValue(1);
    h.savedCount.mockResolvedValue(0);
    h.enquiryCreate.mockResolvedValue({ id: "enq-new" });
    h.savedCreate.mockResolvedValue({ id: "search-1" });
  });

  it("rechecks the admin release cap and fresh status under the dealer lock", async () => {
    h.listingFindUnique
      .mockResolvedValueOnce({ dealerId: "dealer-1" })
      .mockResolvedValueOnce(publishable("PENDING_REVIEW"));
    h.listingCount.mockResolvedValue(50);
    await expect(changeTradeListingStatus({ actor: admin, listingId: "listing-1", to: "LIVE", now })).resolves.toEqual({
      error: "Trade Exchange allows 50 live listings.",
    });
    expect(lockCalls()[0]).toMatchObject({ sql: expect.stringContaining("pg_advisory_xact_lock"), key: "trade-live:dealer-1" });
    expect(h.executeRaw.mock.invocationCallOrder[0]).toBeLessThan(h.listingCount.mock.invocationCallOrder[0]);
    expect(h.listingUpdateMany).not.toHaveBeenCalled();
    expect(h.auditCreate).not.toHaveBeenCalled();

    h.listingFindUnique.mockReset();
    h.listingCount.mockResolvedValue(49);
    h.listingFindUnique
      .mockResolvedValueOnce({ dealerId: "dealer-1" })
      .mockResolvedValueOnce(publishable("PENDING_REVIEW"));
    await expect(changeTradeListingStatus({ actor: admin, listingId: "listing-1", to: "LIVE", now })).resolves.toEqual({ ok: true });
    expect(h.listingUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "listing-1", status: "PENDING_REVIEW" },
      data: expect.objectContaining({ status: "LIVE", publishedAt: now }),
    }));
    expect(h.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "trade.listing.live" }),
    }));

    h.listingUpdateMany.mockClear();
    h.auditCreate.mockClear();
    h.listingFindUnique.mockReset();
    h.listingFindUnique
      .mockResolvedValueOnce({ dealerId: "dealer-1" })
      .mockResolvedValueOnce(publishable("SOLD"));
    await expect(changeTradeListingStatus({ actor: admin, listingId: "listing-1", to: "LIVE", now })).resolves.toEqual({ error: "Not found." });
    expect(h.listingUpdateMany).not.toHaveBeenCalled();
    expect(h.auditCreate).not.toHaveBeenCalled();
  });

  it("edits and owner status changes from the locked listing", async () => {
    h.listingFindUnique
      .mockResolvedValueOnce({ dealerId: "dealer-1" })
      .mockResolvedValueOnce({ id: "listing-1", dealerId: "dealer-1", status: "SOLD" });
    await expect(updateTradeListing(owner, "listing-1", listingInput)).resolves.toEqual({ error: "Not found." });
    expect(lockCalls().map((call) => call.key)).toContain("trade-live:dealer-1");
    expect(h.listingUpdate).not.toHaveBeenCalled();

    h.listingFindUnique.mockReset();
    h.imageCount.mockResolvedValue(0);
    h.listingFindUnique
      .mockResolvedValueOnce({ dealerId: "dealer-1" })
      .mockResolvedValueOnce({ id: "listing-1", dealerId: "dealer-1", status: "LIVE" });
    await expect(updateTradeListing(owner, "listing-1", listingInput)).resolves.toEqual({
      error: "Add at least one photo before publishing.",
    });
    expect(h.listingUpdate).not.toHaveBeenCalled();

    h.listingFindUnique.mockReset();
    h.listingFindUnique
      .mockResolvedValueOnce({ dealerId: "dealer-1" })
      .mockResolvedValueOnce({ id: "listing-1", dealerId: "dealer-1", status: "SOLD", images: [] });
    await expect(changeTradeListingStatus({ actor: owner, listingId: "listing-1", to: "RESERVED", now })).resolves.toEqual({ error: "Not found." });
    expect(h.listingUpdateMany).not.toHaveBeenCalled();
  });

  it("rechecks the photo count after upload and keeps the final photo", async () => {
    h.imageCount.mockResolvedValue(0);
    h.listingFindUnique
      .mockResolvedValueOnce({ id: "listing-1", dealerId: "dealer-1", status: "DRAFT", images: [] })
      .mockResolvedValueOnce({ dealerId: "dealer-1" })
      .mockResolvedValueOnce({
        id: "listing-1",
        dealerId: "dealer-1",
        status: "DRAFT",
        images: Array.from({ length: 12 }, (_, index) => ({ id: `image-${index}` })),
      });
    await expect(addTradePhoto(owner, "listing-1", jpeg)).resolves.toEqual({ error: "A trade listing can have 12 photos." });
    expect(h.storeFile).toHaveBeenCalledTimes(1);
    expect(h.imageCreate).not.toHaveBeenCalled();
    expect(h.deleteFile).toHaveBeenCalledTimes(1);
    expect(h.deleteFile).toHaveBeenCalledWith("file-new", "/new.jpg");

    h.deleteFile.mockClear();
    h.imageFindUnique.mockResolvedValue({
      id: "image-1",
      fileId: "file-old",
      filePath: "/old.jpg",
      listing: { id: "listing-1", dealerId: "dealer-1", status: "LIVE", images: [{ id: "image-1" }] },
    });
    await expect(removeTradePhoto(owner, "image-1")).resolves.toEqual({
      error: "A published trade listing needs at least one photo.",
    });
    expect(h.imageDeleteMany).not.toHaveBeenCalled();
    expect(h.deleteFile).not.toHaveBeenCalled();
    expect(lockCalls().map((call) => call.key)).toContain("trade-live:dealer-1");
  });

  it("serializes the first enquiry and bumps the inbox time on reply", async () => {
    h.listingFindUnique
      .mockResolvedValueOnce(liveListing())
      .mockResolvedValueOnce(liveListing(past));
    await expect(sendTradeEnquiry(buyer, { listingId: "listing-1", body: "Is it available?" })).resolves.toEqual({ error: "Not found." });
    expect(h.enquiryCreate).not.toHaveBeenCalled();
    expect(h.messageCreate).not.toHaveBeenCalled();

    h.listingFindUnique.mockReset();
    h.listingFindUnique.mockResolvedValue(liveListing());
    h.enquiryFindUnique.mockResolvedValue({ id: "enq-1", status: "DECLINED" });
    await expect(sendTradeEnquiry(buyer, { listingId: "listing-1", body: "Any update?" })).resolves.toEqual({ error: "This enquiry is closed." });
    expect(h.messageCreate).not.toHaveBeenCalled();
    expect(lockCalls().map((call) => call.key)).toContain("trade-enquiry:listing-1:dealer-2");

    h.enquiryFindUnique.mockResolvedValue(null);
    h.messageCreate.mockClear();
    await expect(sendTradeEnquiry(buyer, { listingId: "listing-1", body: "Is it available?" })).resolves.toEqual({ ok: true, id: "enq-new" });
    expect(h.enquiryCreate).toHaveBeenCalledTimes(1);
    expect(h.messageCreate).toHaveBeenCalledTimes(1);

    const open = {
      id: "enq-1",
      listingId: "listing-1",
      fromDealerId: "dealer-2",
      toDealerId: "dealer-1",
      status: "OPEN",
      fromDealer: { user: { email: "buyer@example.com" } },
      toDealer: { user: { email: "seller@example.com" } },
    };
    h.enquiryFindUnique.mockReset();
    h.enquiryFindUnique
      .mockResolvedValueOnce(open)
      .mockResolvedValueOnce(open)
      .mockResolvedValueOnce({ ...open, status: "CLOSED" });
    h.messageCreate.mockClear();
    await expect(replyToTradeEnquiry(buyer, "enq-1", "Still interested")).resolves.toEqual({ error: "This enquiry is closed." });
    expect(h.messageCreate).not.toHaveBeenCalled();

    h.enquiryFindUnique.mockResolvedValue(open);
    await expect(replyToTradeEnquiry(buyer, "enq-1", "Still interested")).resolves.toEqual({ ok: true });
    expect(h.enquiryUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "enq-1", status: { in: ["OPEN", "ACCEPTED_IN_PRINCIPLE"] } },
      data: { updatedAt: expect.any(Date) },
    }));
    expect(h.messageCreate.mock.invocationCallOrder[0]).toBeLessThan(h.enquiryUpdateMany.mock.invocationCallOrder.at(-1) ?? 0);

    h.enquiryUpdateMany.mockResolvedValueOnce({ count: 0 });
    await expect(changeTradeEnquiryStatus(owner, "enq-1", "DECLINED")).resolves.toEqual({ error: "Not found." });
  });

  it("serializes saved-search creation and retries alerts after a failed send", async () => {
    h.savedCount.mockResolvedValue(10);
    await expect(saveTradeSearch(owner, "Focus alerts", {})).resolves.toEqual({ error: "Save up to 10 searches." });
    expect(h.savedCreate).not.toHaveBeenCalled();
    expect(lockCalls().map((call) => call.key)).toContain("trade-saved:dealer-1");

    h.savedCount.mockResolvedValue(2);
    await expect(saveTradeSearch(owner, "Focus alerts", {})).resolves.toEqual({ ok: true, id: "search-1" });
    expect(h.savedCreate).toHaveBeenCalledTimes(1);

    const since = new Date("2026-10-01T00:00:00.000Z");
    h.listingFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{
      make: "Ford",
      model: "Focus",
      year: 2019,
      mileage: 1000,
      transmission: "Manual",
      fuel: "Petrol",
      conditionSummary: "Good",
      priceType: "POA",
      pricePence: null,
      dealerId: "dealer-2",
      publishedAt: new Date("2026-10-15T11:00:00.000Z"),
    }]);
    h.savedFindMany.mockResolvedValue([{
      id: "search-1",
      dealerId: "dealer-1",
      filters: {},
      lastNotifiedAt: since,
      dealer: { user: { email: "seller@example.com" } },
    }]);
    h.sendEmail.mockRejectedValueOnce(new Error("mailbox down"));
    await expect(maintainTradeExchange(now)).resolves.toEqual({ expired: 0, alerts: 0 });
    expect(h.listingFindMany.mock.calls[1]?.[0]?.where).toEqual({
      status: "LIVE",
      dealerId: { in: ["dealer-2"] },
      expiresAt: { gt: now },
      publishedAt: { gt: since, lte: now },
    });
    expect(h.savedUpdate).not.toHaveBeenCalled();
    expect(h.sendEmail).toHaveBeenCalledTimes(1);

    h.listingFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    h.sendEmail.mockClear();
    await expect(maintainTradeExchange(now)).resolves.toEqual({ expired: 0, alerts: 0 });
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(h.savedUpdate).toHaveBeenCalledWith({ where: { id: "search-1" }, data: { lastNotifiedAt: now } });

    h.listingFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{
      make: "Ford",
      model: "Focus",
      year: 2019,
      mileage: 1000,
      transmission: "Manual",
      fuel: "Petrol",
      conditionSummary: "Good",
      priceType: "POA",
      pricePence: null,
      dealerId: "dealer-2",
      publishedAt: new Date("2026-10-15T11:00:00.000Z"),
    }]);
    h.savedUpdate.mockClear();
    h.sendEmail.mockResolvedValue(undefined);
    await expect(maintainTradeExchange(now)).resolves.toEqual({ expired: 0, alerts: 1 });
    expect(h.savedUpdate).toHaveBeenCalledWith({ where: { id: "search-1" }, data: { lastNotifiedAt: now } });
    expect(h.sendEmail.mock.invocationCallOrder[0]).toBeLessThan(h.savedUpdate.mock.invocationCallOrder[0]);
  });

  it("returns saved-alert success explicitly and excludes expired stock from the live summary", async () => {
    await expect(notifyTradeSavedSearch("seller@example.com", 2)).resolves.toBe(true);
    h.sendEmail.mockRejectedValueOnce(new Error("down"));
    await expect(notifyTradeSavedSearch("seller@example.com", 2)).resolves.toBe(false);
    await expect(notifyTradeSavedSearch("not-an-email", 1)).resolves.toBe(false);
    expect(h.sendEmail).toHaveBeenCalledTimes(2);

    h.listingFindMany.mockResolvedValue([
      { status: "LIVE", expiresAt: past },
      { status: "LIVE", expiresAt: future },
      { status: "LIVE", expiresAt: soon },
      { status: "DRAFT", expiresAt: null },
    ]);
    h.enquiryCount.mockResolvedValue(1);
    await expect(tradeStockSummary("dealer-1", now)).resolves.toEqual({ live: 2, drafts: 1, stale: 1, enquiries: 1 });
  });

  it("holds a report only while the listing is still live and audits a single resolve", async () => {
    h.listingFindUnique
      .mockResolvedValueOnce(liveListing())
      .mockResolvedValueOnce({ id: "listing-1", dealerId: "dealer-1", status: "SOLD" });
    await expect(reportTradeListing(buyer, { listingId: "listing-1", reasonCode: "MISLEADING", details: "Price is wrong." })).resolves.toEqual({ ok: true });
    expect(lockCalls().map((call) => call.key)).toContain("trade-live:dealer-1");
    expect(h.reportCreate).toHaveBeenCalledTimes(1);
    expect(h.listingUpdateMany).not.toHaveBeenCalled();
    expect(h.listingEventCreate).not.toHaveBeenCalled();

    h.listingFindUnique.mockReset();
    h.listingFindUnique.mockResolvedValue(liveListing());
    await expect(reportTradeListing(buyer, { listingId: "listing-1", reasonCode: "MISLEADING", details: "Price is wrong." })).resolves.toEqual({ ok: true });
    expect(h.listingUpdateMany).toHaveBeenCalledWith({
      where: { id: "listing-1", status: "LIVE" },
      data: { status: "PENDING_REVIEW" },
    });
    expect(h.listingEventCreate).toHaveBeenCalledTimes(1);

    h.reportFindUnique.mockResolvedValue({ id: "report-1", status: "OPEN", listingId: "listing-1" });
    h.reportUpdateMany.mockResolvedValueOnce({ count: 0 });
    await expect(resolveTradeReport("admin-1", "report-1", "RESOLVED")).resolves.toEqual({ error: "Not found." });
    expect(h.auditCreate).not.toHaveBeenCalled();

    h.reportUpdateMany.mockResolvedValueOnce({ count: 1 });
    await expect(resolveTradeReport("admin-1", "report-1", "RESOLVED")).resolves.toEqual({ ok: true });
    expect(h.auditCreate).toHaveBeenCalledTimes(1);
    expect(h.reportUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "report-1", status: "OPEN" },
    }));
  });
});

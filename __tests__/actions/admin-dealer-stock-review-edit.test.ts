import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fingerprintSnapshot } from "@/lib/dealer-stock-sync/fingerprint";
import { loadStockSyncSnapshot } from "@/lib/dealer-stock-sync/snapshot";
import type { PlanAction } from "@/lib/dealer-stock-sync/types";

const { requireRole, db, checkRateLimit } = vi.hoisted(() => ({
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(),
  db: {
    dealerProfile: { findUnique: vi.fn() },
    dealerStockSyncReport: { findUnique: vi.fn(), updateMany: vi.fn() },
    dealerStockSyncJob: { findFirst: vi.fn(), create: vi.fn() },
    dealerStockSyncAudit: { create: vi.fn() },
    dealerStockSourceIdentity: { update: vi.fn(), updateMany: vi.fn() },
    listing: { findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    category: { findMany: vi.fn(), findFirst: vi.fn() },
    region: { findFirst: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({ requireRole }));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));

const { loadStockReviewVehicle, saveStockReviewVehicle } = await import("@/actions/admin/dealer-stock-review-edit");

function actionError(result: object) {
  return ("error" in result ? result.error : undefined) as string & Record<string, unknown>;
}

const identity = {
  sourceIdentityKey: "sourceVehicleId:abc",
  listingId: null,
  absenceCount: 0,
  lastAbsenceRunId: null,
  lastSeenRunId: "run-1",
  baselinePricePence: null,
  baselineMileage: null,
};

const category = {
  id: "cat-car",
  slug: "car",
  name: "Cars",
  attributeDefinitions: [
    { id: "mileage", slug: "mileage", name: "Mileage", dataType: "number", required: true, options: null },
    { id: "make", slug: "make", name: "Make", dataType: "text", required: true, options: null },
    { id: "model", slug: "model", name: "Model", dataType: "text", required: true, options: null },
  ],
};

function blocked(overrides: Partial<Extract<PlanAction, { kind: "blocked" }>> = {}): PlanAction {
  return {
    kind: "blocked",
    section: "new",
    reason: "review-flag",
    sourceIdentityKey: "sourceVehicleId:abc",
    listingId: null,
    displayTitle: "2020 Ford Focus",
    review: {
      displayTitle: "2020 Ford Focus",
      flags: ["missing-description"],
      pricePence: null,
      mileage: null,
      year: null,
      categorySlug: "car",
      sourceUrl: "https://dealer.example/focus",
      safePhotoUrls: ["https://images.example/car.jpg"],
      availability: "available",
      provenance: ["reviewed-snapshot"],
      sourceHash: "a".repeat(64),
      capturedAt: "2026-10-21T00:00:00.000Z",
      coverageWarning: null,
      capacityWarning: null,
      fuel: null,
      transmission: null,
    },
    ...overrides,
  };
}

function input(fingerprint: string, overrides: Record<string, unknown> = {}) {
  return {
    reportId: "report-1",
    fingerprint,
    sourceIdentityKey: "sourceVehicleId:abc",
    categorySlug: "car",
    title: "Ford Focus",
    description: "A complete description of this available vehicle.",
    price: 1_250_000,
    attributes: { mileage: "1000", make: "Ford", model: "Focus" },
    photoUrls: ["https://images.example/car.jpg"],
    reason: "Admin corrected the missing description.",
    confirmAvailable: true,
    ...overrides,
  };
}

async function install(actions: PlanAction[], listings: unknown[] = []) {
  db.dealerProfile.findUnique.mockResolvedValue({
    id: "dealer-1",
    tier: "STARTER",
    isAdminPreview: false,
    userId: "user-1",
    stockSourceBinding: {
      id: "binding-1",
      registryKey: "franklins",
      enabled: true,
      verifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      identities: [identity],
    },
    user: { role: "DEALER", disabledAt: null, deletedAt: null, regionId: "region-1" },
  });
  db.listing.findMany.mockResolvedValue(listings);
  db.listing.count.mockResolvedValue(listings.length);
  const snapshot = await loadStockSyncSnapshot("dealer-1", actions);
  if (!snapshot) throw new Error("Expected a snapshot.");
  const fingerprint = fingerprintSnapshot(snapshot);
  const plan = { actions, reviewSource: { sourceHash: "source-hash", counts: { blocked: 1, importable: 0 } } };
  db.dealerStockSyncReport.findUnique.mockResolvedValue({
    id: "report-1",
    status: "PENDING_REVIEW",
    fingerprint,
    bindingId: "binding-1",
    dealerId: "dealer-1",
    plan,
  });
  return { fingerprint, plan, actions };
}

describe("admin stock review corrections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("POLICY_ENFORCE_LISTING_NS", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("DEALER_STOCK_SYNC_TARGET", "local");
    vi.stubEnv("DEALER_STOCK_SYNC_ISOLATED_LOCAL", "1");
    for (const key of ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING"]) {
      vi.stubEnv(key, "postgresql://fixture@127.0.0.1:5432/test");
    }
    requireRole.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    checkRateLimit.mockResolvedValue({ allowed: true, remaining: 19, resetAt: 0, unavailable: false });
    db.$transaction.mockImplementation(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db));
    db.$queryRaw.mockResolvedValue([]);
    db.dealerStockSyncJob.findFirst.mockResolvedValue(null);
    db.region.findFirst.mockResolvedValue({ id: "region-1" });
    db.category.findFirst.mockResolvedValue(category);
    db.category.findMany.mockResolvedValue([{ ...category, attributes: undefined }]);
    db.dealerStockSyncReport.updateMany.mockResolvedValue({ count: 1 });
    db.dealerStockSyncAudit.create.mockResolvedValue({ id: "audit-1" });
  });

  it("rejects non-admins, disabled environments and rate limits before writes", async () => {
    requireRole.mockRejectedValue(new Error("Insufficient permissions"));
    await expect(saveStockReviewVehicle(input("a".repeat(64)))).rejects.toThrow(/permissions/i);
    expect(db.dealerStockSyncReport.findUnique).not.toHaveBeenCalled();

    requireRole.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("DEALER_STOCK_SYNC_PRODUCTION_ENABLED", "0");
    const disabled = await saveStockReviewVehicle(input("a".repeat(64)));
    expect(actionError(disabled)).toMatch(/disabled in production/);
    expect(db.$transaction).not.toHaveBeenCalled();

    vi.stubEnv("VERCEL_ENV", "");
    checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: 0, unavailable: false });
    const limited = await saveStockReviewVehicle(input("a".repeat(64)));
    expect(limited).toEqual({ error: "Too many stock sync requests. Try again shortly." });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects invalid price, photos, stale status and ineligible source rows without writes", async () => {
    const held = await install([blocked()]);
    const price = await saveStockReviewVehicle(input(held.fingerprint, { price: 50 }));
    expect(actionError(price)).toMatchObject({ price: expect.any(Array) });
    const photo = await saveStockReviewVehicle(input(held.fingerprint, { photoUrls: ["https://10.0.0.1/a.jpg"] }));
    expect(actionError(photo)).toMatchObject({ photoUrls: expect.any(Array) });
    expect(db.dealerStockSyncReport.updateMany).not.toHaveBeenCalled();

    db.dealerStockSyncReport.findUnique.mockResolvedValue({
      id: "report-1", status: "APPROVED", fingerprint: held.fingerprint, bindingId: "binding-1", dealerId: "dealer-1", plan: held.plan,
    });
    const status = await saveStockReviewVehicle(input(held.fingerprint));
    expect(status).toEqual({ error: "This review is stale. Reload the page and try again." });

    const soldHeld = await install([blocked({ reason: "sold-exclude-from-live-import" })]);
    const sold = await saveStockReviewVehicle(input(soldHeld.fingerprint));
    expect(actionError(sold)).toMatch(/cannot be corrected/);
    expect(db.dealerStockSyncAudit.create).not.toHaveBeenCalled();
    expect(db.listing.create).not.toHaveBeenCalled();
  });

  it("uses the worker snapshot relations and leaves no audit when the compare-and-swap fails", async () => {
    const held = await install([blocked()]);
    db.dealerStockSyncReport.updateMany.mockResolvedValueOnce({ count: 0 });
    const result = await saveStockReviewVehicle(input(held.fingerprint));
    expect(result).toEqual({ error: "This review is stale. Reload the page and try again." });
    expect(db.dealerStockSyncAudit.create).not.toHaveBeenCalled();
    expect(db.listing.create).not.toHaveBeenCalled();
    expect(db.dealerStockSourceIdentity.update).not.toHaveBeenCalled();
    expect(db.dealerProfile.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        stockSourceBinding: expect.objectContaining({ select: expect.objectContaining({ identities: true }) }),
        user: expect.objectContaining({ select: expect.objectContaining({ regionId: true }) }),
      }),
    }));
    expect(db.listing.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { dealerId: "dealer-1", retentionPurgedAt: null, previewPackId: null },
      select: expect.objectContaining({
        attributeValues: { select: { value: true, attributeDefinition: { select: { slug: true } } } },
        revisions: { where: { status: { in: ["DRAFT", "PENDING"] } }, select: { id: true } },
      }),
    }));
    expect(String(db.$queryRaw.mock.calls.at(-1)?.[0])).toMatch(/DealerStockSyncReport/);
    expect(String(db.$queryRaw.mock.calls.at(-1)?.[0])).toMatch(/FOR UPDATE/);
  });

  it("rolls back when the report update fails", async () => {
    const held = await install([blocked()]);
    db.dealerStockSyncReport.updateMany.mockRejectedValueOnce(new Error("serialization failure"));
    const result = await saveStockReviewVehicle(input(held.fingerprint));
    expect(result).toEqual({ error: "Website stock sync could not be updated." });
    expect(db.dealerStockSyncAudit.create).not.toHaveBeenCalled();
    expect(db.dealerStockSyncJob.create).not.toHaveBeenCalled();
  });

  it("keeps a corrected row pending, audited and unpublished", async () => {
    const original = blocked();
    const held = await install([original]);
    const result = await saveStockReviewVehicle(input(held.fingerprint));
    expect(result).toMatchObject({ data: { dealerId: "dealer-1" } });
    expect(original.kind).toBe("blocked");
    expect(held.plan.reviewSource.counts).toEqual({ blocked: 1, importable: 0 });
    const saved = db.dealerStockSyncReport.updateMany.mock.calls.at(-1)?.[0];
    expect(saved.where).toMatchObject({ status: "PENDING_REVIEW", fingerprint: held.fingerprint });
    expect(saved.data.status).toBe("PENDING_REVIEW");
    expect(saved.data.fingerprint).not.toBe(held.fingerprint);
    expect(saved.data.plan.actions[0]).toMatchObject({
      kind: "create",
      sourceIdentityKey: "sourceVehicleId:abc",
      ownedImages: [],
      sourceUrl: "https://dealer.example/focus",
    });
    expect(saved.data.plan.reviewSource.counts).toBeUndefined();
    expect(saved.data).not.toHaveProperty("approvedAt");
    const audit = db.dealerStockSyncAudit.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ reportId: "report-1", actorId: "admin-1", action: "admin-stock-review-correction" });
    expect(audit.before.action.kind).toBe("blocked");
    expect(audit.before.fingerprint).toBe(held.fingerprint);
    expect(audit.after.action.kind).toBe("create");
    expect(audit.after.reason).toMatch(/missing description/);
    expect(db.dealerStockSyncJob.findFirst).toHaveBeenCalledWith({
      where: {
        bindingId: "binding-1",
        OR: [
          { status: { in: ["QUEUED", "LEASED"] } },
          { kind: "APPLY", reportId: "report-1", status: { notIn: ["FAILED", "CANCELLED"] } },
        ],
      },
      select: { id: true },
    });
    expect(db.dealerStockSyncJob.create).not.toHaveBeenCalled();
    expect(db.listing.create).not.toHaveBeenCalled();
    expect(db.listing.update).not.toHaveBeenCalled();
    expect(db.dealerStockSourceIdentity.updateMany).not.toHaveBeenCalled();
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15_000,
    });
  });

  it("rejects unknown attributes, invalid mileage, linked identities and sold titles", async () => {
    const held = await install([blocked()]);
    const unknown = await saveStockReviewVehicle(input(held.fingerprint, {
      attributes: { mileage: "1000", make: "Ford", model: "Focus", bogus: "1" },
    }));
    expect(unknown).toEqual({ error: "Unknown vehicle details cannot be saved." });

    const mileage = await saveStockReviewVehicle(input(held.fingerprint, {
      attributes: { mileage: "nope", make: "Ford", model: "Focus" },
    }));
    expect(JSON.stringify(actionError(mileage))).toMatch(/Mileage/);

    db.dealerProfile.findUnique.mockResolvedValue({
      id: "dealer-1",
      tier: "STARTER",
      isAdminPreview: false,
      userId: "user-1",
      stockSourceBinding: {
        id: "binding-1",
        registryKey: "franklins",
        enabled: true,
        verifiedAt: new Date("2026-01-01T00:00:00.000Z"),
        identities: [{ ...identity, listingId: "listing-1" }],
      },
      user: { role: "DEALER", disabledAt: null, deletedAt: null, regionId: "region-1" },
    });
    const linkedFingerprint = fingerprintSnapshot((await loadStockSyncSnapshot("dealer-1", held.actions))!);
    db.dealerStockSyncReport.findUnique.mockResolvedValue({ ...held, fingerprint: linkedFingerprint, id: "report-1", status: "PENDING_REVIEW", bindingId: "binding-1", dealerId: "dealer-1" });
    const linked = await saveStockReviewVehicle(input(linkedFingerprint));
    expect(actionError(linked)).toMatch(/already linked/);

    const soldListing = {
      id: "listing-sold", updatedAt: new Date("2026-01-01T00:00:00.000Z"), userId: "user-1", title: "Ford Focus",
      description: "Sold vehicle kept out of the import.", status: "SOLD", price: 1000, featured: false,
      expiresAt: null, soldAt: new Date("2026-02-01T00:00:00.000Z"), lifecycleRevision: 1, photoRevision: 1,
      reviewSourceIdentity: null, slug: "ford-focus", previewPackId: null, attributeValues: [], revisions: [],
    };
    const soldHeld = await install([blocked()], [soldListing]);
    const sold = await saveStockReviewVehicle(input(soldHeld.fingerprint));
    expect(actionError(sold)).toMatch(/sold listing/);
    expect(db.dealerStockSyncReport.updateMany).not.toHaveBeenCalled();
    expect(db.dealerStockSyncAudit.create).not.toHaveBeenCalled();
  });

  it("loads a blank manual draft when the saved review has no source metadata", async () => {
    const held = await install([blocked({ review: undefined })]);
    db.category.findMany.mockResolvedValue([category]);
    const result = await loadStockReviewVehicle({
      reportId: "report-1",
      fingerprint: held.fingerprint,
      sourceIdentityKey: "sourceVehicleId:abc",
    });
    expect("data" in result && result.data?.draft.description).toBe("");
    expect("data" in result && result.data?.draft.attributes.make).toBeUndefined();
    expect("data" in result && result.data?.categories[0]?.attributes[0]).toMatchObject({
      id: "mileage",
      slug: "mileage",
      dataType: "number",
      required: true,
    });
  });

  it("does not invent a write-off category for a manual correction", async () => {
    vi.stubEnv("POLICY_ENFORCE_LISTING_NS", "true");
    db.category.findFirst.mockResolvedValue({
      ...category,
      attributeDefinitions: [
        ...category.attributeDefinitions,
        {
          id: "write-off",
          slug: "write-off-category",
          name: "Write-off category",
          dataType: "select",
          required: false,
          options: JSON.stringify(["None", "Category N", "Category S"]),
        },
      ],
    });
    const held = await install([blocked()]);
    const result = await saveStockReviewVehicle(input(held.fingerprint));
    expect(JSON.stringify(actionError(result))).toMatch(/Write-off category/);
    expect(JSON.stringify(result)).not.toMatch(/"value":"None"/);
    expect(db.dealerStockSyncReport.updateMany).not.toHaveBeenCalled();
  });

  it("allows source-detail overrides but rejects changed snapshots, queued jobs and listing caps", async () => {
    const held = await install([blocked({ reason: "source-conflict" })]);
    expect(await saveStockReviewVehicle(input(held.fingerprint))).toHaveProperty("data");
    db.dealerStockSyncReport.updateMany.mockClear();
    db.dealerStockSyncJob.findFirst.mockResolvedValueOnce({ id: "queued-job" });
    expect(actionError(await saveStockReviewVehicle(input(held.fingerprint)))).toMatch(/already queued/);
    const snapshot = await loadStockSyncSnapshot("dealer-1", held.actions);
    db.listing.count.mockResolvedValue(30);
    expect(actionError(await saveStockReviewVehicle(input(held.fingerprint)))).toMatch(/stale/);
    const capFingerprint = fingerprintSnapshot({ ...snapshot!, activeListingCount: 30 });
    db.dealerStockSyncReport.findUnique.mockResolvedValue({ id: "report-1", status: "PENDING_REVIEW", fingerprint: capFingerprint, dealerId: "dealer-1", bindingId: "binding-1", plan: held.plan });
    expect(actionError(await saveStockReviewVehicle(input(capFingerprint)))).toMatch(/listing limit/);
    expect(db.dealerStockSyncReport.updateMany).not.toHaveBeenCalled();
  });
});

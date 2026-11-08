import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, auth, transition, claim, rate, capture } = vi.hoisted(() => ({
  db: {
    listing: { findUnique: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    listingAttributeValue: { deleteMany: vi.fn(), createMany: vi.fn() },
    category: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  auth: vi.fn(), transition: vi.fn(), claim: vi.fn(), rate: vi.fn(), capture: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/policy/gate", () => ({ requireAcceptedAuth: auth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache.js", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/dist/server/web/spec-extension/revalidate", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/dist/server/web/spec-extension/revalidate.js", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ captureException: capture, reportHandledException: vi.fn(), captureBusinessEvent: vi.fn() }));
vi.mock("@/lib/listings/status-events", () => ({ transitionListingStatus: transition }));
vi.mock("@/lib/config/marketplace", () => ({ claimFreeListingSlot: claim }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: rate, makeRateLimitKey: vi.fn() }));
vi.mock("@/lib/listings/retained-attributes", () => ({ loadRetainedAttributeValues: vi.fn().mockResolvedValue([]) }));
import { updateListing, submitListingForReview } from "@/actions/listings";

const id = "cm000000000000000000000001";
const saved = { id, userId: "owner", dealerId: "dealer", categoryId: "category", status: "DRAFT", lifecycleRevision: 4, stockReviewHeld: false };
beforeEach(() => {
  vi.resetAllMocks();
  auth.mockResolvedValue({ id: "owner", role: "DEALER", dealerProfile: { id: "dealer" }, email: "owner@example.com" });
  db.listing.findUnique.mockResolvedValue(saved);
  db.listing.findUniqueOrThrow.mockResolvedValue({ ...saved, title: "Saved correction", lifecycleRevision: 5 });
  db.listing.updateMany.mockResolvedValue({ count: 1 });
  db.category.findUnique.mockResolvedValue({ id: "category", active: true, slug: "car", attributeDefinitions: [] });
  db.$transaction.mockImplementation(async fn => fn(db));
  rate.mockReturnValue({ allowed: true });
});

describe("dealer mutations after stock draft recall", () => {
  it("rejects stale detail editing and submission before writes or payment side effects", async () => {
    db.listing.findUnique.mockResolvedValue({ ...saved, stockReviewHeld: true });
    expect(await updateListing({ id, title: "Stale dealer correction" })).toMatchObject({ error: expect.stringContaining("pulled back") });
    expect(await submitListingForReview({ listingId: id })).toMatchObject({ error: expect.stringContaining("pulled back") });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });
  it("preserves normal edits and advances the lifecycle version used by recall", async () => {
    const result = await updateListing({ id, title: "Saved correction" });
    expect(capture).not.toHaveBeenCalled();
    expect(result).toMatchObject({ data: { id, lifecycleRevision: 5 } });
    expect(db.listing.updateMany).toHaveBeenCalledWith({
      where: { id, userId: "owner", status: "DRAFT", lifecycleRevision: 4, stockReviewHeld: false },
      data: { title: "Saved correction", lifecycleRevision: { increment: 1 } },
    });
  });
  it("loses a concurrent recall CAS without saving any details or attributes", async () => {
    db.listing.updateMany.mockResolvedValue({ count: 0 });
    const result = await updateListing({ id, title: "Stale dealer correction" });
    expect(capture).not.toHaveBeenCalled();
    expect(result).toMatchObject({ conflict: true });
    expect(db.listingAttributeValue.deleteMany).not.toHaveBeenCalled();
    expect(db.listingAttributeValue.createMany).not.toHaveBeenCalled();
    expect(db.listing.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it("does not expose another owner's held draft", async () => {
    db.listing.findUnique.mockResolvedValue({ ...saved, userId: "other", stockReviewHeld: true });
    expect(await updateListing({ id, title: "Correction" })).toEqual({ error: "This listing isn't available for that action." });
  });
});

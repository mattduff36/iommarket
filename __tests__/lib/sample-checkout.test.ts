import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, tx, state } = vi.hoisted(() => {
  const state: { existing: Record<string, unknown> | null; listing: Record<string, unknown> | null } = {
    existing: null,
    listing: { id: "listing-1", userId: "user-1", status: "DRAFT", featured: false, expiresAt: null },
  };
  const tx = {
    $queryRaw: vi.fn(),
    listing: { findFirst: vi.fn(async () => state.listing) },
    dealerProfile: { findFirst: vi.fn(), update: vi.fn() },
    subscription: { findFirst: vi.fn(async () => null) },
    sampleCheckout: {
      findFirst: vi.fn(async () => state.existing),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "new-sample", ...data, status: "PENDING", attemptCount: 0,
        currency: "gbp", createdAt: new Date(), updatedAt: new Date(),
      })),
    },
    payment: { create: vi.fn() },
  };
  const mockDb = {
    sampleCheckout: { findFirst: vi.fn() },
    $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
  };
  return { mockDb, tx, state };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));

import { getCurrentUser } from "@/lib/auth";
import { createSampleCheckout, getSampleCheckout } from "@/lib/payments/sample-checkout";

const originalEnvironment = { ...process.env };

describe("sample checkout service", () => {
  beforeEach(() => {
    Object.assign(process.env, originalEnvironment, {
      VERCEL_ENV: "preview",
      POSTGRES_URL: "postgresql://postgres:secret@db.syneonzucehwlghqmfbg.supabase.co:5432/postgres",
    });
    state.existing = null;
    state.listing = { id: "listing-1", userId: "user-1", status: "DRAFT", featured: false, expiresAt: null };
    vi.clearAllMocks();
    mockDb.$transaction.mockImplementation(async (callback: (client: unknown) => unknown) => callback(tx));
    tx.listing.findFirst.mockImplementation(async () => state.listing);
    tx.sampleCheckout.findFirst.mockImplementation(async () => state.existing);
    tx.sampleCheckout.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "new-sample", ...data, status: "PENDING", attemptCount: 0,
      currency: "gbp", createdAt: new Date(), updatedAt: new Date(),
    }));
    tx.subscription.findFirst.mockResolvedValue(null);
  });

  it("checks target ownership and creates a DEV payment with a private simulator URL", async () => {
    const result = await createSampleCheckout({
      userId: "user-1", kind: "listing_payment", targetId: "listing-1",
      description: "Listing payment", amountPence: 499, returnUrl: "/sell/checkout",
    });
    expect(tx.listing.findFirst).toHaveBeenCalledWith({ where: { id: "listing-1", userId: "user-1" } });
    expect(result.data.checkoutUrl).toBe("/sample-checkout/new-sample");
    expect(tx.payment.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      listingId: "listing-1", paymentProvider: "DEV", providerReference: "sim_new-sample",
      idempotencyKey: "sim_new-sample", status: "PENDING", amount: 499,
    }) });
  });

  it("returns no checkout to an unauthenticated reader", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect(await getSampleCheckout("checkout-1")).toBeNull();
    expect(mockDb.sampleCheckout.findFirst).not.toHaveBeenCalled();
  });

  it("scopes read-only checkout access to the current user without requiring new policy acceptance", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1" } as NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>);
    mockDb.sampleCheckout.findFirst.mockResolvedValue(null);
    expect(await getSampleCheckout("checkout-1")).toBeNull();
    expect(mockDb.sampleCheckout.findFirst).toHaveBeenCalledWith({ where: { id: "checkout-1", userId: "user-1" } });
  });

  it("rejects a target the authenticated user does not own before creating checkout or payment rows", async () => {
    state.listing = null;
    await expect(createSampleCheckout({
      userId: "attacker", kind: "listing_payment", targetId: "listing-1",
      description: "Listing payment", amountPence: 499, returnUrl: "/sell/checkout",
    })).rejects.toThrow("Listing not found.");
    expect(tx.sampleCheckout.create).not.toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it("reuses a pending checkout for the same user, target, amount, and tier", async () => {
    state.existing = { id: "existing-sample" };
    const result = await createSampleCheckout({
      userId: "user-1", kind: "listing_payment", targetId: "listing-1",
      description: "Listing payment", amountPence: 499, returnUrl: "/sell/checkout",
    });
    expect(result.data.checkoutUrl).toBe("/sample-checkout/existing-sample");
    expect(tx.sampleCheckout.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      userId: "user-1", targetId: "listing-1", kind: "listing_payment", amountPence: 499,
      status: { in: ["PENDING", "FAILED"] }, attemptCount: { lt: 3 },
    }) }));
    expect(tx.sampleCheckout.create).not.toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
  });
});

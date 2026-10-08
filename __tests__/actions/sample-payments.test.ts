import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SampleCheckoutRow = {
  id: string;
  userId: string;
  kind: "listing_payment" | "dealer_subscription";
  targetId: string;
  description: string;
  amountPence: number;
  currency: string;
  tier: string | null;
  status: "PENDING" | "FAILED" | "SUCCEEDED" | "CANCELLED";
  attemptCount: number;
  returnUrl: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

const { authMock, rateLimitMock, revalidatePathMock, mockDb, tx } = vi.hoisted(() => {
  const row: SampleCheckoutRow = {
    id: "cmpl0000000000000000000000", userId: "user-1", kind: "listing_payment",
    targetId: "listing-1", description: "Listing payment", amountPence: 499,
    currency: "gbp", tier: null, status: "PENDING", attemptCount: 0,
    returnUrl: "/sell/checkout", expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(), updatedAt: new Date(),
  };
  const tx = {
    $queryRaw: vi.fn(),
    sampleCheckout: {
      findFirst: vi.fn(async (): Promise<SampleCheckoutRow | null> => row),
      update: vi.fn(async ({ data }: { data: Partial<SampleCheckoutRow> }) => Object.assign(row, data)),
    },
    payment: { updateMany: vi.fn(async () => ({ count: 1 })) },
    listing: { findFirst: vi.fn(async () => ({ id: "listing-1", userId: "user-1", status: "DRAFT", featured: false, expiresAt: null })) },
    dealerProfile: { findFirst: vi.fn(), update: vi.fn() },
    subscription: { findFirst: vi.fn(async (): Promise<{ id: string; paymentProvider: string; source?: string; status: string } | null> => null), upsert: vi.fn(async () => ({ id: "subscription-1" })) },
    subscriptionCharge: { create: vi.fn() },
    user: { updateMany: vi.fn() },
  };
  const mockDb = {
    $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
    sampleCheckout: { findFirst: vi.fn(async (): Promise<SampleCheckoutRow | null> => row) },
  };
  return { authMock: vi.fn(), rateLimitMock: vi.fn(), revalidatePathMock: vi.fn(), mockDb, tx, row };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/policy/gate", () => ({ requireAcceptedAuth: authMock }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: rateLimitMock,
  makeRateLimitKey: vi.fn(() => "sample:user-1"),
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/payments/webhook-payments", () => ({ submitPaidListingForReview: vi.fn(async () => []) }));

import { cancelSamplePayment, submitSamplePayment } from "@/actions/sample-payments";

const originalEnvironment = { ...process.env };
const state = vi.hoisted(() => ({ row: null as SampleCheckoutRow | null }));

describe("sample payment actions", () => {
  beforeEach(() => {
    Object.assign(process.env, originalEnvironment, {
      VERCEL_ENV: "preview",
      POSTGRES_URL: "postgresql://postgres:secret@db.syneonzucehwlghqmfbg.supabase.co:5432/postgres",
    });
    state.row = {
      id: "cmpl0000000000000000000000", userId: "user-1", kind: "listing_payment",
      targetId: "listing-1", description: "Listing payment", amountPence: 499,
      currency: "gbp", tier: null, status: "PENDING", attemptCount: 0,
      returnUrl: "/sell/checkout", expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(), updatedAt: new Date(),
    };
    const current = () => state.row!;
    authMock.mockResolvedValue({ id: "user-1", role: "USER" });
    rateLimitMock.mockResolvedValue({ allowed: true });
    mockDb.$transaction.mockImplementation(async (callback: (client: unknown) => unknown) => callback(tx));
    tx.sampleCheckout.findFirst.mockImplementation(async () => current());
    tx.sampleCheckout.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => Object.assign(current(), data));
    tx.payment.updateMany.mockResolvedValue({ count: 1 });
    tx.listing.findFirst.mockResolvedValue({ id: "listing-1", userId: "user-1", status: "DRAFT", featured: false, expiresAt: null });
    tx.subscription.findFirst.mockResolvedValue(null);
    tx.$queryRaw.mockResolvedValue([]);
    vi.clearAllMocks();
    // Reapply implementations cleared above.
    authMock.mockResolvedValue({ id: "user-1", role: "USER" });
    rateLimitMock.mockResolvedValue({ allowed: true });
    mockDb.$transaction.mockImplementation(async (callback: (client: unknown) => unknown) => callback(tx));
    tx.sampleCheckout.findFirst.mockImplementation(async () => current());
    tx.sampleCheckout.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => Object.assign(current(), data));
    tx.payment.updateMany.mockResolvedValue({ count: 1 });
    tx.listing.findFirst.mockResolvedValue({ id: "listing-1", userId: "user-1", status: "DRAFT", featured: false, expiresAt: null });
    tx.subscription.findFirst.mockResolvedValue(null);
    tx.$queryRaw.mockResolvedValue([]);
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it("fails closed in production even if the preview database and forged flags are supplied", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.RIPPLE_SAMPLE_CHECKOUT_ENABLED = "1";
    await expect(submitSamplePayment({ checkoutId: state.row!.id, card: "approve", attempt: 1 }))
      .resolves.toEqual({ error: "Sample payments are unavailable in this environment." });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("enforces checkout ownership before changing its state", async () => {
    authMock.mockResolvedValue({ id: "another-user", role: "USER" });
    tx.sampleCheckout.findFirst.mockResolvedValue(null);
    const result = await submitSamplePayment({ checkoutId: state.row!.id, card: "approve", attempt: 1 });
    expect(result).toEqual({ error: "Sample checkout not found." });
    expect(tx.sampleCheckout.findFirst).toHaveBeenCalledWith({
      where: { id: state.row!.id, userId: "another-user" },
    });
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
  });

  it("records a decline, ignores a replayed attempt, and allows the next attempt to approve", async () => {
    const declined = await submitSamplePayment({ checkoutId: state.row!.id, card: "decline", attempt: 1 });
    expect(declined.data?.status).toBe("FAILED");
    expect(declined.data?.attemptCount).toBe(1);
    expect(tx.payment.updateMany).toHaveBeenCalledTimes(1);

    const replay = await submitSamplePayment({ checkoutId: state.row!.id, card: "approve", attempt: 1 });
    expect(replay.data?.status).toBe("FAILED");
    expect(tx.payment.updateMany).toHaveBeenCalledTimes(1);

    const retry = await submitSamplePayment({ checkoutId: state.row!.id, card: "approve", attempt: 2 });
    expect(retry.data?.status).toBe("SUCCEEDED");
    expect(retry.data?.attemptCount).toBe(2);
    expect(tx.payment.updateMany).toHaveBeenCalledTimes(2);
  });

  it("rejects a fourth attempt, expires stale checkouts, and cancels pending payment records", async () => {
    state.row!.attemptCount = 3;
    state.row!.status = "FAILED";
    const capped = await submitSamplePayment({ checkoutId: state.row!.id, card: "approve", attempt: 4 });
    expect(capped).toEqual({ error: "Choose one of the sample cards." });

    state.row!.status = "PENDING";
    state.row!.attemptCount = 0;
    state.row!.expiresAt = new Date(Date.now() - 1);
    const expired = await submitSamplePayment({ checkoutId: state.row!.id, card: "approve", attempt: 1 });
    expect(expired.data?.status).toBe("CANCELLED");
    expect(tx.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "FAILED" } }));

    state.row!.status = "PENDING";
    state.row!.expiresAt = new Date(Date.now() + 60_000);
    const cancelled = await cancelSamplePayment({ checkoutId: state.row!.id });
    expect(cancelled.data?.status).toBe("CANCELLED");
  });

  it("blocks fake subscription attempts when the dealer already has a genuine paid subscription", async () => {
    state.row!.kind = "dealer_subscription";
    state.row!.targetId = "dealer-1";
    state.row!.tier = "PRO";
    tx.dealerProfile.findFirst.mockResolvedValue({ id: "dealer-1", userId: "user-1" });
    tx.subscription.findFirst.mockResolvedValue({ id: "real-sub", paymentProvider: "RIPPLE", source: "PAYMENT", status: "ACTIVE" });
    const result = await submitSamplePayment({ checkoutId: state.row!.id, card: "decline", attempt: 1 });
    expect(result).toEqual({ error: "This account has a real subscription. Use another preview account to test sample subscriptions." });
    expect(tx.subscription.upsert).not.toHaveBeenCalled();
    expect(tx.subscriptionCharge.create).not.toHaveBeenCalled();
  });

  it("does not fulfill another checkout while a sample subscription is active", async () => {
    state.row!.kind = "dealer_subscription";
    state.row!.targetId = "dealer-1";
    state.row!.tier = "PRO";
    tx.dealerProfile.findFirst.mockResolvedValue({ id: "dealer-1", userId: "user-1" });
    tx.subscription.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "active-sample", paymentProvider: "DEV", status: "ACTIVE" });
    const result = await submitSamplePayment({ checkoutId: state.row!.id, card: "approve", attempt: 1 });
    expect(result.error).toBe("This account already has an active sample subscription.");
    expect(tx.subscription.upsert).not.toHaveBeenCalled();
    expect(tx.subscriptionCharge.create).not.toHaveBeenCalled();
  });
});

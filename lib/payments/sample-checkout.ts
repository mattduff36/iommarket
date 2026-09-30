import { db } from "@/lib/db";
import { requireAcceptedAuth } from "@/lib/policy/gate";
import type { Prisma, SampleCheckout } from "@prisma/client";
import { assertSampleCheckoutEnabled, isSampleCheckoutEnabled, SAMPLE_MAX_ATTEMPTS } from "./sample-checkout-config";

export type SampleCheckoutKind = "listing_payment" | "featured_upgrade" | "dealer_subscription";
export type SampleCheckoutView = {
  id: string; kind: SampleCheckoutKind; description: string; amountPence: number;
  currency: string; status: "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  attemptCount: number; returnUrl: string; expiresAt: string;
};

export function sampleCheckoutView(row: SampleCheckout): SampleCheckoutView {
  return {
    id: row.id, kind: row.kind as SampleCheckoutKind, description: row.description,
    amountPence: row.amountPence, currency: row.currency,
    status: row.status as SampleCheckoutView["status"], attemptCount: row.attemptCount,
    returnUrl: row.kind === "dealer_subscription" && row.status === "SUCCEEDED"
      ? "/dealer/dashboard?subscribed=true" : row.returnUrl,
    expiresAt: row.expiresAt.toISOString(),
  };
}

export async function assertSampleTarget(tx: Prisma.TransactionClient, row: {
  kind: string; targetId: string; userId: string;
}) {
  if (row.kind === "dealer_subscription") {
    await tx.$queryRaw`SELECT id FROM "DealerProfile" WHERE id = ${row.targetId} FOR UPDATE`;
    const dealer = await tx.dealerProfile.findFirst({ where: { id: row.targetId, userId: row.userId } });
    if (!dealer) throw new Error("Dealer profile not found.");
    // A fake decline must never change or mask a genuine recurring subscription.
    const real = await tx.subscription.findFirst({ where: {
      dealerId: row.targetId, paymentProvider: { not: "DEV" }, source: "PAYMENT",
      OR: [{ status: { in: ["ACTIVE", "PAST_DUE"] } }, { providerLifecycle: { in: ["ACTIVE", "PAUSED"] } }],
    } });
    if (real) throw new Error("This account has a real subscription. Use another preview account to test sample subscriptions.");
    const activeSample = await tx.subscription.findFirst({ where: {
      dealerId: row.targetId, paymentProvider: "DEV", status: "ACTIVE", currentPeriodEnd: { gt: new Date() },
    } });
    if (activeSample) throw new Error("This account already has an active sample subscription.");
    return;
  }
  await tx.$queryRaw`SELECT id FROM "Listing" WHERE id = ${row.targetId} FOR UPDATE`;
  const listing = await tx.listing.findFirst({ where: { id: row.targetId, userId: row.userId } });
  if (!listing) throw new Error("Listing not found.");
  if (row.kind === "featured_upgrade" && (listing.status !== "LIVE" || listing.featured ||
    (listing.expiresAt && listing.expiresAt <= new Date()))) {
    throw new Error("Only an eligible live listing can be featured.");
  }
}

export async function createSampleCheckout(input: {
  userId: string; kind: SampleCheckoutKind; targetId: string; description: string;
  amountPence: number; tier?: "STARTER" | "PRO"; returnUrl: string;
}) {
  assertSampleCheckoutEnabled();
  if (!Number.isSafeInteger(input.amountPence) || input.amountPence <= 0 ||
    !input.returnUrl.startsWith("/") || input.returnUrl.startsWith("//") || /[\\\r\n]/.test(input.returnUrl)) {
    throw new Error("Invalid sample checkout.");
  }
  const checkout = await db.$transaction(async (tx) => {
    await assertSampleTarget(tx, input);
    const existing = await tx.sampleCheckout.findFirst({ where: {
      userId: input.userId, kind: input.kind, targetId: input.targetId,
      amountPence: input.amountPence, tier: input.tier ?? null,
      status: { in: ["PENDING", "FAILED"] }, attemptCount: { lt: SAMPLE_MAX_ATTEMPTS },
      expiresAt: { gt: new Date() },
    }, orderBy: { createdAt: "desc" } });
    if (existing) return existing;
    const row = await tx.sampleCheckout.create({ data: {
      ...input, expiresAt: new Date(Date.now() + 30 * 60_000),
    } });
    if (input.kind !== "dealer_subscription") {
      await tx.payment.create({ data: {
        listingId: input.targetId, type: input.kind === "featured_upgrade" ? "FEATURED" : "LISTING",
        paymentProvider: "DEV", status: "PENDING", amount: input.amountPence, currency: "gbp",
        providerReference: `sim_${row.id}`, idempotencyKey: `sim_${row.id}`,
      } });
    }
    return row;
  });
  return { data: { checkoutUrl: `/sample-checkout/${checkout.id}` } };
}

export async function getSampleCheckout(id: string): Promise<SampleCheckoutView | null> {
  if (!isSampleCheckoutEnabled()) return null;
  const user = await requireAcceptedAuth();
  const checkout = await db.sampleCheckout.findFirst({ where: { id, userId: user.id } });
  return checkout ? sampleCheckoutView(checkout) : null;
}

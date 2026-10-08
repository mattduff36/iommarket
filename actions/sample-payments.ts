"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAcceptedAuth } from "@/lib/policy/gate";
import { captureException } from "@/lib/monitoring";
import {
  asActionFailure,
  publicErrorBody,
  withMonitoringReference,
  type ActionFailure,
} from "@/lib/forms/public-error";
import {
  SAMPLE_OUTCOME_UNKNOWN,
  checkoutAuthBody,
} from "@/lib/payments/checkout-public-error";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";
import { isSampleCheckoutEnabled, SAMPLE_MAX_ATTEMPTS } from "@/lib/payments/sample-checkout-config";
import { assertSampleTarget, sampleCheckoutView, type SampleCheckoutView } from "@/lib/payments/sample-checkout";
import { fulfillSampleCheckout } from "@/lib/payments/sample-checkout-fulfillment";

const checkoutIdSchema = z.string().cuid();
const paymentSchema = z.object({ checkoutId: checkoutIdSchema,
  card: z.enum(["approve", "decline"]), attempt: z.number().int().min(1).max(SAMPLE_MAX_ATTEMPTS),
}).strict();

async function changeCheckout(
  input: unknown,
  cancel: boolean,
): Promise<{ data?: SampleCheckoutView; error?: string } | ActionFailure> {
  if (!isSampleCheckoutEnabled()) {
    return { error: "Sample payments are unavailable in this environment." };
  }
  try {
    return await changeCheckoutBody(input, cancel);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (SAMPLE_KNOWN.has(message)) return { error: message };
    return asActionFailure(await withMonitoringReference(
      publicErrorBody({ message: SAMPLE_OUTCOME_UNKNOWN, code: "unknown", retryable: false }),
      () => captureException({
        source: "SERVER",
        error,
        action: cancel ? "cancelSamplePayment" : "submitSamplePayment",
        route: "/sample-checkout",
        requestPath: "/sample-checkout",
      }),
    ));
  }
}

const SAMPLE_KNOWN = new Set<string>([
  "Sample checkout not found.",
  "Listing not found.",
  "Dealer profile not found.",
  "Only an eligible live listing can be featured.",
  "This account has a real subscription. Use another preview account to test sample subscriptions.",
  "This account already has an active sample subscription.",
  "This sample checkout has no payment attempt available. Return to iTrader to start again.",
]);

async function changeCheckoutBody(
  input: unknown,
  cancel: boolean,
): Promise<{ data?: SampleCheckoutView; error?: string } | ActionFailure> {
  let user: Awaited<ReturnType<typeof requireAcceptedAuth>>;
  try {
    user = await requireAcceptedAuth();
  } catch (error) {
    const specific = checkoutAuthBody(error);
    if (specific && specific.code !== "unavailable") return specific;
    const body = specific ?? asActionFailure(publicErrorBody({
      message: SAMPLE_OUTCOME_UNKNOWN,
      code: "unknown",
      retryable: false,
    }));
    return asActionFailure(await withMonitoringReference(body, () => captureException({
      source: "SERVER",
      error,
      action: "sampleCheckout",
      route: "/sample-checkout",
      requestPath: "/sample-checkout",
    })));
  }
  const parsed = cancel
    ? z.object({ checkoutId: checkoutIdSchema }).strict().safeParse(input)
    : paymentSchema.safeParse(input);
  if (!parsed.success) return { error: "Choose one of the sample cards." };
  const limited = await checkRateLimit(makeRateLimitKey("sample-checkout", user.id), {
    windowMs: 60_000, maxRequests: 15, policy: "sample-checkout",
  });
  if (!limited.allowed) return { error: "Too many attempts. Please wait a minute." };
  try {
    const row = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "SampleCheckout" WHERE id = ${parsed.data.checkoutId} AND "userId" = ${user.id} FOR UPDATE`;
      const checkout = await tx.sampleCheckout.findFirst({ where: { id: parsed.data.checkoutId, userId: user.id } });
      if (!checkout) throw new Error("Sample checkout not found.");
      if (checkout.status === "SUCCEEDED" || checkout.status === "CANCELLED") return checkout;
      if (cancel || checkout.expiresAt <= new Date()) {
        await tx.payment.updateMany({ where: {
          providerReference: `sim_${checkout.id}`, paymentProvider: "DEV", status: "PENDING",
        }, data: { status: "FAILED" } });
        return tx.sampleCheckout.update({ where: { id: checkout.id }, data: { status: "CANCELLED" } });
      }
      const paymentInput = paymentSchema.parse(input);
      // A repeated request for an already-recorded attempt cannot change its result.
      if (paymentInput.attempt <= checkout.attemptCount) return checkout;
      if (checkout.attemptCount >= SAMPLE_MAX_ATTEMPTS || paymentInput.attempt !== checkout.attemptCount + 1) {
        throw new Error("This sample checkout has no payment attempt available. Return to iTrader to start again.");
      }
      await assertSampleTarget(tx, checkout);
      const status = paymentInput.card === "approve" ? "SUCCEEDED" : "FAILED";
      await fulfillSampleCheckout(tx, checkout, status, paymentInput.attempt);
      return tx.sampleCheckout.update({ where: { id: checkout.id }, data: { status, attemptCount: paymentInput.attempt } });
    });
    revalidatePath("/account/listings");
    revalidatePath("/dealer/dashboard");
    revalidatePath("/dealer/subscribe");
    revalidatePath("/sell/checkout");
    revalidatePath(`/listings/${row.targetId}`);
    return { data: sampleCheckoutView(row) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const safe = ["Sample checkout not found.", "Listing not found.", "Dealer profile not found.",
      "Only an eligible live listing can be featured.",
      "This account has a real subscription. Use another preview account to test sample subscriptions.",
      "This account already has an active sample subscription.",
      "This sample checkout has no payment attempt available. Return to iTrader to start again."];
    if (safe.includes(message)) return { error: message };
    return asActionFailure(await withMonitoringReference(
      publicErrorBody({ message: SAMPLE_OUTCOME_UNKNOWN, code: "unknown", retryable: false }),
      () => captureException({
        source: "SERVER",
        error,
        action: cancel ? "cancelSamplePayment" : "submitSamplePayment",
        route: "/sample-checkout",
        requestPath: "/sample-checkout",
        userId: user.id,
        userEmail: user.email,
      }),
    ));
  }
}

export async function submitSamplePayment(input: { checkoutId: string; card: "approve" | "decline"; attempt: number }) {
  return changeCheckout(input, false);
}

export async function cancelSamplePayment(input: { checkoutId: string }) {
  return changeCheckout(input, true);
}

export async function readSamplePaymentStatus(checkoutId: string) {
  const { getSampleCheckout } = await import("@/lib/payments/sample-checkout");
  if (!checkoutIdSchema.safeParse(checkoutId).success) return null;
  return getSampleCheckout(checkoutId);
}

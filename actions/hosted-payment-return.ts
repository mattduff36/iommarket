"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { HostedCheckoutLink } from "@/lib/payments/checkout-handoff";
import { readLinkedHostedCheckout } from "@/lib/payments/hosted-checkout-link";
import { decodeHostedReturnContext, HOSTED_RETURN_COOKIE, type HostedReturnContext } from "@/lib/payments/hosted-return-context";
import { reconcileHostedReturn } from "@/lib/payments/reconcile-hosted-return";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { reportVerifiedServicePurchase } from "@/lib/advertising/purchase";

type HostedReturnGate =
  | { ok: true; context: HostedReturnContext }
  | { ok: false; status: "review" | "sign-in" | "waiting" };

async function openHostedReturn(): Promise<HostedReturnGate> {
  const context = decodeHostedReturnContext((await cookies()).get(HOSTED_RETURN_COOKIE)?.value);
  if (!context) return { ok: false, status: "review" };
  const user = await getCurrentUser();
  if (!user) return { ok: false, status: "sign-in" };
  if (user.id !== context.userId || user.email.trim().toLowerCase() !== context.email) {
    return { ok: false, status: "review" };
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser?.email_confirmed_at || authUser.id !== user.authUserId ||
    authUser.email?.trim().toLowerCase() !== context.email) return { ok: false, status: "review" };
  const limit = await checkRateLimit(makeRateLimitKey("hosted-return", user.id), {
    windowMs: 5 * 60_000, maxRequests: 60, policy: "hosted-return",
  });
  if (!limit.allowed || limit.unavailable) return { ok: false, status: "waiting" };
  return { ok: true, context };
}

export async function confirmHostedListingPayment(paymentJobRef: string): Promise<{
  status: "confirmed" | "waiting" | "review" | "sign-in";
  listingId?: string;
  checkoutType?: "listing_payment" | "listing_and_featured" | "featured_upgrade" | "dealer_subscription";
}> {
  // Cashflows identifiers exceed JS's safe integer range: preserve exact strings.
  if (typeof paymentJobRef !== "string" || !/^\d{10,30}$/.test(paymentJobRef)) return { status: "review" };
  try {
    const gate = await openHostedReturn();
    if (!gate.ok) return { status: gate.status };
    const result = await reconcileHostedReturn(gate.context, paymentJobRef);
    if (result.status === "confirmed") {
      try {
        await reportVerifiedServicePurchase(paymentJobRef);
      } catch {
        // Advertising delivery must not change a confirmed payment.
      }
      revalidatePath("/sell/checkout");
      revalidatePath("/account/listings");
      if (result.checkoutType === "dealer_subscription") {
        revalidatePath("/account");
        revalidatePath("/dealer");
      }
    }
    return result;
  } catch {
    // Includes serializable transaction conflicts. Never invite a second payment.
    return { status: "waiting" };
  }
}

export async function readHostedCheckoutLink(): Promise<HostedCheckoutLink> {
  try {
    const gate = await openHostedReturn();
    if (!gate.ok) return { status: gate.status };
    return await readLinkedHostedCheckout(db, gate.context);
  } catch {
    return { status: "waiting" };
  }
}

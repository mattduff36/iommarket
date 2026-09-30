"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { decodeHostedReturnContext, HOSTED_RETURN_COOKIE } from "@/lib/payments/hosted-return-context";
import { reconcileHostedReturn } from "@/lib/payments/reconcile-hosted-return";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";

export async function confirmHostedListingPayment(paymentJobRef: string): Promise<{
  status: "confirmed" | "waiting" | "review" | "sign-in";
  listingId?: string;
  checkoutType?: "listing_payment" | "featured_upgrade" | "dealer_subscription";
}> {
  // Cashflows identifiers exceed JS's safe integer range: preserve exact strings.
  if (typeof paymentJobRef !== "string" || !/^\d{10,30}$/.test(paymentJobRef)) return { status: "review" };
  try {
    const context = decodeHostedReturnContext((await cookies()).get(HOSTED_RETURN_COOKIE)?.value);
    if (!context) return { status: "review" };
    const user = await getCurrentUser();
    if (!user) return { status: "sign-in" };
    if (user.id !== context.userId || user.email.trim().toLowerCase() !== context.email) return { status: "review" };
    const supabase = await createSupabaseServerClient();
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser?.email_confirmed_at || authUser.id !== user.authUserId ||
      authUser.email?.trim().toLowerCase() !== context.email) return { status: "review" };
    const limit = await checkRateLimit(makeRateLimitKey("hosted-return", user.id), {
      windowMs: 5 * 60_000, maxRequests: 60, policy: "hosted-return",
    });
    if (!limit.allowed || limit.unavailable) return { status: "waiting" };
    const result = await reconcileHostedReturn(context, paymentJobRef);
    if (result.status === "confirmed") {
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

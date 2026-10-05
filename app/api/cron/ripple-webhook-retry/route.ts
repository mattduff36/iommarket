import { NextRequest, NextResponse } from "next/server";
import { retryFailedRippleWebhooks } from "@/lib/payments/ripple-inbox";
import { isCronAuthorized } from "@/lib/ops/safety";
import { detectStalePaymentAttempts } from "@/lib/payments/stale-attempts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  // Reconcile verified receipts first so a successful replay cannot race a
  // stale-attempt alert for the same checkout.
  const webhooks = await retryFailedRippleWebhooks();
  const attempts = await detectStalePaymentAttempts();
  return NextResponse.json({ data: { webhooks, attempts } });
}

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { acceptedAuthHttpStatus } from "@/lib/policy/gate";
import { checkRateLimit, makeRateLimitKey, toRateLimitDenial } from "@/lib/rate-limit";
import { captureException } from "@/lib/monitoring";
import { publicErrorBody } from "@/lib/forms/public-error";
import { loadStockReviewSnapshot } from "@/app/(admin)/admin/stock-reviews/snapshot-loader";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  try {
    const admin = await requireRole("ADMIN");
    const denial = toRateLimitDenial(await checkRateLimit(makeRateLimitKey("stock-review-snapshot", admin.id), {
      windowMs: 60_000, maxRequests: 120, policy: "stock-review-snapshot",
    }), "Too many updates. Please wait a moment.");
    if (denial) return NextResponse.json(publicErrorBody({ message: denial.message, code: denial.status === 429 ? "rate_limited" : "unavailable", retryAfterSeconds: denial.retryAfterSeconds }), { status: denial.status, headers: { ...headers, "Retry-After": String(denial.retryAfterSeconds) } });
    return NextResponse.json(await loadStockReviewSnapshot(), { headers });
  } catch (error) {
    const status = acceptedAuthHttpStatus(error);
    if (status === 500) await captureException({ source: "SERVER", error, route: "/api/admin/stock-reviews/snapshot", action: "stockReviewSnapshot" });
    return NextResponse.json(publicErrorBody({ message: status === 401 ? "Sign in to receive updates." : status === 403 ? "Access denied." : "Updates temporarily unavailable.", code: status === 401 ? "unauthorized" : status === 403 ? "forbidden" : "unavailable" }), { status, headers });
  }
}

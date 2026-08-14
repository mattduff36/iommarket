import { NextRequest, NextResponse } from "next/server";
import {
  expireAbandonedListingImageIntents,
  processListingImageCleanupJobs,
} from "@/lib/listings/photo-cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const expired = await expireAbandonedListingImageIntents();
  const processed = await processListingImageCleanupJobs(50);
  return NextResponse.json({
    data: {
      expired: expired.expired,
      processed: processed.processed,
    },
  });
}

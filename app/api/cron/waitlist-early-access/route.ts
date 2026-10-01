import { NextRequest, NextResponse } from "next/server";
import { deliverEarlyAccessBatch } from "@/lib/waitlist/early-access/delivery";
import { isCronAuthorized } from "@/lib/ops/safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const delivery = await deliverEarlyAccessBatch();
  return NextResponse.json({ data: delivery });
}

import { getDealerStockSyncAvailability } from "@/lib/deployment/dealer-stock-sync";
import { NextRequest, NextResponse } from "next/server";
import { enqueueDueWeeklyScrapes } from "@/lib/dealer-stock-sync/enqueue";
import { isCronAuthorized } from "@/lib/ops/safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const availability = getDealerStockSyncAvailability();
  if (!availability.enabled) return NextResponse.json({ error: availability.reason }, { status: 403 });
  const summary = await enqueueDueWeeklyScrapes(new Date());
  return NextResponse.json({ data: summary });
}

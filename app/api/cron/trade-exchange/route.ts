import { NextRequest, NextResponse } from "next/server";
import { maintainTradeExchange } from "@/lib/trade-exchange/maintenance";
import { isCronAuthorized } from "@/lib/ops/safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  }
  const result = await maintainTradeExchange();
  return NextResponse.json({ data: result }, { headers: { "Cache-Control": "private, no-store" } });
}

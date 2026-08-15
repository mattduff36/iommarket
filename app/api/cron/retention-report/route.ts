import { NextRequest, NextResponse } from "next/server";
import { runRetentionPass } from "@/lib/retention/report";
import { isCronAuthorized } from "@/lib/ops/safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const result = await runRetentionPass();
  return NextResponse.json({ data: result });
}

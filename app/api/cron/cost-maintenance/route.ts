import { NextRequest, NextResponse } from "next/server";
import { isCostsEnabled } from "@/lib/costs/config";
import { retryPendingCostEmails } from "@/lib/costs/email";
import { runCostSync } from "@/lib/costs/sync";
import { isCronAuthorized } from "@/lib/ops/safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  if (!isCostsEnabled()) {
    return NextResponse.json({ data: { status: "skipped" } });
  }

  const sync = await runCostSync({
    trigger: "CRON",
    eventId: `cron:${new Date().toISOString().slice(0, 10)}`,
  });
  const emails = await retryPendingCostEmails();
  return NextResponse.json({
    data: {
      sync,
      emails,
    },
  });
}

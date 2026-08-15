import { NextRequest, NextResponse } from "next/server";
import { runAccountDeletionWorker } from "@/lib/privacy/account-deletion";
import { isCronAuthorized } from "@/lib/ops/safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const result = await runAccountDeletionWorker();
  return NextResponse.json({ data: result });
}

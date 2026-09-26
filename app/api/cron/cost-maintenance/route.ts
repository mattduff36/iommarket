import { NextRequest, NextResponse } from "next/server";
import { CostConfigError, isCostsEnabled } from "@/lib/costs/config";
import { assertCanonicalLedgerWriter } from "@/lib/costs/ledger-role";
import { retryPendingCostEmails } from "@/lib/costs/email";
import { runCostSync } from "@/lib/costs/sync";
import { isCronAuthorized } from "@/lib/ops/safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A bounded FOCUS slice can stream slowly and is retried by the adapter.
export const maxDuration = 180;

function syncStatusCode(status: "skipped" | "locked" | "succeeded" | "failed"): number {
  if (status === "failed") return 502;
  if (status === "locked") return 409;
  return 200;
}

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  try {
    assertCanonicalLedgerWriter();
  } catch (error) {
    if (error instanceof CostConfigError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

  if (!isCostsEnabled()) {
    return NextResponse.json({ data: { status: "skipped" } });
  }

  const sync = await runCostSync({
    trigger: "CRON",
    eventId: `cron:${new Date().toISOString().slice(0, 10)}`,
  });
  const emails = await retryPendingCostEmails();
  return NextResponse.json(
    {
      data: {
        sync,
        emails,
      },
    },
    { status: syncStatusCode(sync.status) },
  );
}

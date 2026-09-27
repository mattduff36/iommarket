import { NextRequest, NextResponse } from "next/server";
import { CostConfigError, isBearerSecretAuthorized, isCostsEnabled } from "@/lib/costs/config";
import { manualCostSyncMessage } from "@/lib/costs/copy";
import { assertCanonicalLedgerWriter } from "@/lib/costs/ledger-role";
import { runCostSync } from "@/lib/costs/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

function statusCode(
  status: "skipped" | "locked" | "partial" | "succeeded" | "failed",
): number {
  return status === "failed" ? 502 : 200;
}

export async function POST(request: NextRequest) {
  if (!isBearerSecretAuthorized(
    request.headers.get("authorization"),
    process.env.COST_LEDGER_REQUEST_SECRET,
  )) {
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

  await request.text();
  if (!isCostsEnabled()) {
    const message = manualCostSyncMessage({ status: "skipped" });
    return NextResponse.json({ data: { status: "skipped", message } });
  }

  try {
    const result = await runCostSync({
      trigger: "MANUAL",
      eventId: `remote:${crypto.randomUUID()}`,
    });
    const message = manualCostSyncMessage(result);
    return NextResponse.json(
      { data: { ...result, message } },
      { status: statusCode(result.status) },
    );
  } catch {
    const message = manualCostSyncMessage({ status: "failed" });
    return NextResponse.json(
      { error: message, data: { status: "failed", message } },
      { status: 502 },
    );
  }
}

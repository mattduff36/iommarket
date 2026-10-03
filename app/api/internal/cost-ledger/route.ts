import { NextRequest, NextResponse } from "next/server";
import { isBearerSecretAuthorized, isCostsEnabled } from "@/lib/costs/config";
import { costDb } from "@/lib/costs/db";
import { getCostDashboard } from "@/lib/costs/queries";
import { assertCanonicalLedgerWriter } from "@/lib/costs/ledger-role";
import { CostConfigError } from "@/lib/costs/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isBearerSecretAuthorized(
    request.headers.get("authorization"),
    process.env.COST_LEDGER_READ_SECRET,
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

  if (!isCostsEnabled()) {
    return NextResponse.json({ error: "Cost tracking is not enabled." }, { status: 404 });
  }

  const dashboard = await getCostDashboard({
    db: costDb,
    enabled: true,
    // This endpoint is bearer-authenticated and consumed server-to-server;
    // the receiving app removes this owner-only payload before serialization
    // for any non-owner session.
    isOwner: true,
  });
  return NextResponse.json({
    data: {
      ...dashboard,
      affectsLiveLedger: true,
    },
  });
}

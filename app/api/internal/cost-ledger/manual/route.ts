import { NextRequest, NextResponse } from "next/server";
import { CostConfigError, isBearerSecretAuthorized, isCostsEnabled } from "@/lib/costs/config";
import { costDb } from "@/lib/costs/db";
import { CostLedgerError } from "@/lib/costs/ledger";
import { assertCanonicalLedgerWriter } from "@/lib/costs/ledger-role";
import { recordManualLedgerCost } from "@/lib/costs/manual-entry";
import { recordManualCostSchema } from "@/lib/validations/costs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  if (!isCostsEnabled()) {
    return NextResponse.json({ error: "Cost tracking is not enabled." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Enter a valid manual cost." }, { status: 400 });
  }

  const parsed = recordManualCostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid manual cost." }, { status: 400 });
  }

  try {
    await recordManualLedgerCost(parsed.data);
    await costDb.costWorkflowEvent.create({
      data: {
        type: "PREVIEW_MANUAL_COST",
        payload: {
          origin: "preview",
          category: parsed.data.category,
          externalRef: parsed.data.externalRef,
        },
      },
    });
    return NextResponse.json({
      data: { recorded: true, affectsLiveLedger: true },
    });
  } catch (error) {
    if (error instanceof CostLedgerError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to record the cost." }, { status: 500 });
  }
}

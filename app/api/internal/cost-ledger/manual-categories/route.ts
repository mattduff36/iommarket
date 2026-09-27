import { NextRequest, NextResponse } from "next/server";
import { CostConfigError, isBearerSecretAuthorized, isCostsEnabled } from "@/lib/costs/config";
import { assertCanonicalLedgerWriter } from "@/lib/costs/ledger-role";
import {
  createManualCostCategory,
  ManualCategoryError,
} from "@/lib/costs/manual-categories";
import { createManualCostCategorySchema } from "@/lib/validations/costs";

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
    return NextResponse.json({ error: "Enter a category name." }, { status: 400 });
  }

  const parsed = createManualCostCategorySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a category name." }, { status: 400 });
  }

  try {
    const created = await createManualCostCategory(parsed.data.label);
    return NextResponse.json({ data: created });
  } catch (error) {
    if (error instanceof ManualCategoryError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to add the category." }, { status: 500 });
  }
}

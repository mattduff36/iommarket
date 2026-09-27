import { NextRequest, NextResponse } from "next/server";
import { CostConfigError, isBearerSecretAuthorized, isCostsEnabled } from "@/lib/costs/config";
import { CostInvoiceError, createInvoiceRequest } from "@/lib/costs/invoices";
import { assertCanonicalLedgerWriter } from "@/lib/costs/ledger-role";
import { costDb } from "@/lib/costs/db";

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
    if (!isCostsEnabled()) {
      return NextResponse.json({ error: "Cost tracking is not enabled." }, { status: 404 });
    }
    const ownerAuthUserId = process.env.COST_OWNER_AUTH_USER_ID?.trim();
    if (!ownerAuthUserId) {
      return NextResponse.json(
        { error: "The canonical ledger owner is not configured." },
        { status: 500 },
      );
    }
    const owner = await costDb.user.findUnique({
      where: { authUserId: ownerAuthUserId },
      select: { id: true },
    });
    if (!owner) {
      return NextResponse.json(
        { error: "The canonical ledger owner could not be mapped." },
        { status: 500 },
      );
    }
    const actorId = owner.id;
    await request.text();
    const created = await createInvoiceRequest({ requesterUserId: actorId });
    await costDb.costWorkflowEvent.create({
      data: {
        invoiceRequestId: created.request.id,
        type: "PREVIEW_INVOICE_REQUEST",
        actorUserId: actorId,
        payload: { origin: "preview" },
      },
    });
    return NextResponse.json({
      data: { requestId: created.request.id, affectsLiveLedger: true },
    });
  } catch (error) {
    if (error instanceof CostConfigError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof CostInvoiceError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: "Invoice request failed." }, { status: 500 });
  }
}

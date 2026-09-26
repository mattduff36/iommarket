import { NextRequest, NextResponse } from "next/server";
import { CostConfigError, isBearerSecretAuthorized, isCostsEnabled } from "@/lib/costs/config";
import { CURSOR_INGEST_BODY_LIMIT, cursorIngestSchema } from "@/lib/costs/cursor-contract";
import {
  CursorIngestConflictError,
  ingestCursorBatch,
} from "@/lib/costs/cursor-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isBearerSecretAuthorized(
    request.headers.get("authorization"),
    process.env.COST_LEDGER_INGEST_SECRET,
  )) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  if (!isCostsEnabled()) {
    return NextResponse.json({ error: "Cost tracking is not enabled." }, { status: 404 });
  }

  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9:_-]{8,200}$/.test(idempotencyKey)) {
    return NextResponse.json({ error: "A stable idempotency key is required." }, { status: 400 });
  }

  const text = await request.text();
  if (text.length > CURSOR_INGEST_BODY_LIMIT) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = cursorIngestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Cursor usage payload is not valid." }, { status: 400 });
  }

  try {
    const result = await ingestCursorBatch({
      body: parsed.data,
      idempotencyKey,
    });
    return NextResponse.json(
      { data: result },
      { status: result.status === "processing" ? 409 : 200 },
    );
  } catch (error) {
    if (error instanceof CostConfigError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof CursorIngestConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: "Cursor usage could not be stored." }, { status: 500 });
  }
}

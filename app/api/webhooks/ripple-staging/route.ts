import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isRipplePreviewRuntime } from "@/lib/payments/ripple-config";
import { eventFromMinimizedPayload } from "@/lib/payments/ripple-contract";
import { persistRippleWebhookInbox, processRippleInboxRecord } from "@/lib/payments/ripple-inbox";
import { RIPPLE_STAGING_MAX_BODY_BYTES, verifyRippleStagingRelay } from "@/lib/payments/ripple-staging-relay";

export async function POST(req: NextRequest) {
  if (!isRipplePreviewRuntime()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (Number(req.headers.get("content-length")) > RIPPLE_STAGING_MAX_BODY_BYTES) return NextResponse.json({ error: "Invalid relay" }, { status: 413 });
  let envelope: ReturnType<typeof verifyRippleStagingRelay>;
  let event: ReturnType<typeof eventFromMinimizedPayload>;
  try {
    envelope = verifyRippleStagingRelay(await req.text(), req.headers);
    event = eventFromMinimizedPayload(envelope);
  } catch {
    return NextResponse.json({ error: "Invalid relay" }, { status: 400 });
  }
  try {
    // Production owns retry scheduling. Missing listing references are instead
    // resolved by the authenticated checkout return using this durable receipt.
    const inbox = await persistRippleWebhookInbox({ ...envelope, event, rawBody: "", verifiedBodyHash: envelope.bodyHash });
    const result = await processRippleInboxRecord(inbox.id);
    if (result.status !== "processed" && result.status !== "duplicate") {
      const stored = await db.paymentWebhookInbox.findUnique({
        where: { id: inbox.id },
        select: { status: true, lastErrorCode: true },
      });
      if (stored?.status !== "FAILED" || stored.lastErrorCode !== "MISSING_REFERENCE") {
        return NextResponse.json({ error: "Relay processing pending" }, { status: 503 });
      }
    }
    return NextResponse.json({ received: true, bodyHash: envelope.bodyHash });
  } catch {
    return NextResponse.json({ error: "Relay storage failed" }, { status: 503 });
  }
}

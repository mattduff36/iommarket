import { NextRequest, NextResponse } from "next/server";
import { captureException } from "@/lib/monitoring";
import { parseRippleWebhookEnvelope } from "@/lib/payments/ripple-contract";
import { ingestVerifiedRippleWebhook } from "@/lib/payments/ripple-inbox";
import { buildRippleSafeTags } from "@/lib/payments/ripple-privacy";
import { verifyProviderWebhookSignature } from "@/lib/payments/provider";

export async function POST(req: NextRequest) {
  const body = await req.text();

  try {
    verifyProviderWebhookSignature(body, req.headers);
  } catch {
    return NextResponse.json({ error: "Invalid webhook" }, { status: 400 });
  }

  let parsed: ReturnType<typeof parseRippleWebhookEnvelope>;
  try {
    parsed = parseRippleWebhookEnvelope(JSON.parse(body));
  } catch {
    return NextResponse.json({ error: "Invalid webhook" }, { status: 400 });
  }

  try {
    await ingestVerifiedRippleWebhook({
      rawBody: body,
      event: parsed.event,
      minimized: parsed.minimized,
      customerEmailNorm: parsed.customerEmailNorm,
    });
    return NextResponse.json({ received: true });
  } catch (err) {
    await captureException({
      source: "WEBHOOK",
      error: err,
      severity: "HIGH",
      title: "Payment webhook processing failed",
      action: "paymentsWebhookPost",
      route: "/api/webhooks/payments",
      requestPath: "/api/webhooks/payments",
      tags: buildRippleSafeTags({
        eventType: parsed.event.rawType,
      }),
    });
    return NextResponse.json({ received: true });
  }
}

import { NextRequest, NextResponse } from "next/server";
import {
  normalizeProviderWebhookEvent,
  type NormalizedProviderWebhookEvent,
  verifyProviderWebhookSignature,
} from "@/lib/payments/provider";
import { processProviderWebhookEvent } from "@/lib/payments/webhook-processing";
import { captureException } from "@/lib/monitoring";

export async function POST(req: NextRequest) {
  const body = await req.text();

  try {
    verifyProviderWebhookSignature(body, req.headers);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid webhook";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  let event: NormalizedProviderWebhookEvent;
  try {
    event = normalizeProviderWebhookEvent(JSON.parse(body));
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Webhook payload could not be parsed";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    await processProviderWebhookEvent(event);
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
      tags: { eventType: event.type, eventId: event.id, rawType: event.rawType },
    });
    const message = err instanceof Error ? err.message : "Webhook handler error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

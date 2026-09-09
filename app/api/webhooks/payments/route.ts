import { NextRequest, NextResponse } from "next/server";
import { captureBusinessEvent, captureException } from "@/lib/monitoring";
import { parseRippleWebhookEnvelope } from "@/lib/payments/ripple-contract";
import { ingestVerifiedRippleWebhook } from "@/lib/payments/ripple-inbox";
import { buildRippleSafeTags } from "@/lib/payments/ripple-privacy";
import {
  classifyRippleEnvelopeReject,
  rippleRejectTags,
} from "@/lib/payments/ripple-webhook-reject";
import { getRippleWebhookSecret } from "@/lib/payments/ripple-config";
import { describeRippleHmacCandidates } from "@/lib/payments/ripple-signature";
import { verifyProviderWebhookSignature } from "@/lib/payments/provider";

function invalidWebhookResponse() {
  return NextResponse.json({ error: "Invalid webhook" }, { status: 400 });
}

async function reportRippleWebhookReject(
  tags: ReturnType<typeof rippleRejectTags>
) {
  await captureBusinessEvent({
    source: "WEBHOOK",
    severity: "LOW",
    title: "Ripple webhook rejected",
    message: "Ripple webhook failed HMAC or envelope checks before persist.",
    action: "paymentsWebhookReject",
    route: "/api/webhooks/payments",
    requestPath: "/api/webhooks/payments",
    tags,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.text();

  try {
    verifyProviderWebhookSignature(body, req.headers);
  } catch {
    let matches = {};
    try {
      matches = describeRippleHmacCandidates(
        body,
        req.headers,
        getRippleWebhookSecret()
      );
    } catch {
      matches = {};
    }
    await reportRippleWebhookReject(
      rippleRejectTags({
        rejectStage: "hmac",
        headers: req.headers,
        ...matches,
      })
    );
    return invalidWebhookResponse();
  }

  let parsed: ReturnType<typeof parseRippleWebhookEnvelope>;
  try {
    parsed = parseRippleWebhookEnvelope(JSON.parse(body));
  } catch (error) {
    await reportRippleWebhookReject(
      rippleRejectTags({
        rejectStage: "envelope",
        headers: req.headers,
        envReason: classifyRippleEnvelopeReject(error),
      })
    );
    return invalidWebhookResponse();
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
    return NextResponse.json({ error: "Webhook ingest failed" }, { status: 500 });
  }
}

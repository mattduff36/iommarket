import { captureBusinessEvent } from "@/lib/monitoring";
import type { NormalizedProviderWebhookEvent } from "@/lib/payments/provider-types";
import { resolveRippleProduct } from "@/lib/payments/ripple-mapping";
import { buildRippleSafeTags } from "@/lib/payments/ripple-privacy";
import {
  handleFailedOneOffPayment,
  handleOneOffPaymentReceived,
  handleRefundedPayment,
} from "@/lib/payments/webhook-payments";
import {
  handleRecurringPaymentFailed,
  handleRecurringPaymentReceived,
  handleRecurringPaymentSuccess,
  handleSubscriptionCreated,
  handleSubscriptionPausedOrCancelled,
  handleSubscriptionRefundSchedule,
  handleSubscriptionResumed,
} from "@/lib/payments/webhook-subscriptions";

function isDealerEvent(event: NormalizedProviderWebhookEvent) {
  const product = resolveRippleProduct({
    linkCode: event.linkCode,
    packageName: event.packageName,
  });
  return (
    event.metadata.checkoutType === "dealer_subscription" ||
    event.recurring === true ||
    event.linkType === "recurring" ||
    product?.checkoutType === "dealer_subscription" ||
    event.type.startsWith("subscription.")
  );
}

export async function processProviderWebhookEvent(
  event: NormalizedProviderWebhookEvent
) {
  switch (event.type) {
    case "payment.received":
      if (isDealerEvent(event)) {
        await handleRecurringPaymentReceived(event);
        return;
      }
      await handleOneOffPaymentReceived(event);
      return;
    case "payment.succeeded":
      if (!isDealerEvent(event)) {
        throw new Error(
          "Ripple payment.success is only valid for recurring dealer products",
        );
      }
      await handleRecurringPaymentSuccess(event);
      return;
    case "payment.failed":
      if (isDealerEvent(event)) {
        await handleRecurringPaymentFailed(event);
        return;
      }
      await handleFailedOneOffPayment(event);
      return;
    case "payment.refunded": {
      const payment = await handleRefundedPayment(event);
      if (payment) return;
      const scheduled = await handleSubscriptionRefundSchedule(event);
      if (!scheduled) {
        await captureBusinessEvent({
          source: "WEBHOOK",
          severity: "MEDIUM",
          title: "Refund webhook with no matching payment",
          message: "Provider refund webhook did not match a local payment record.",
          action: "handleRefundedPayment",
          route: "/api/webhooks/payments",
          requestPath: "/api/webhooks/payments",
          tags: buildRippleSafeTags({
            eventType: event.rawType,
            checkoutType: event.metadata.checkoutType,
          }),
        });
      }
      return;
    }
    case "subscription.created":
      await handleSubscriptionCreated(event);
      return;
    case "subscription.paused":
      await handleSubscriptionPausedOrCancelled(event, "PAUSED");
      return;
    case "subscription.cancelled":
      await handleSubscriptionPausedOrCancelled(event, "CANCELLED");
      return;
    case "subscription.resumed":
      await handleSubscriptionResumed(event);
      return;
    default:
      return;
  }
}

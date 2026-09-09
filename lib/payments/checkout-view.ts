export type CheckoutPaymentSnapshot = {
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "REFUNDED";
} | null;

export type CheckoutViewState =
  | "submitted"
  | "paid"
  | "failed"
  | "waiting"
  | "opened"
  | "cancelled";

export function resolveCheckoutViewState(input: {
  listingStatus: string;
  payment: CheckoutPaymentSnapshot;
  openedInNewTab: boolean;
}): CheckoutViewState {
  if (input.listingStatus === "PENDING") return "submitted";
  if (input.payment?.status === "SUCCEEDED") return "paid";
  if (input.payment?.status === "FAILED") return "failed";
  if (input.payment?.status === "PENDING") return "waiting";
  if (input.openedInNewTab) return "opened";
  return "cancelled";
}

export function checkoutViewCopy(state: CheckoutViewState): {
  heading: string;
  message: string;
  isAwaitingPayment: boolean;
} {
  switch (state) {
    case "submitted":
      return {
        heading: "Listing submitted",
        message:
          "Your listing has been submitted for moderation. You can safely close any extra payment tabs and continue on itrader.",
        isAwaitingPayment: false,
      };
    case "paid":
      return {
        heading: "Payment received",
        message:
          "We have recorded your payment. If moderation has not updated yet, use the refresh button below and the original itrader tab will catch up.",
        isAwaitingPayment: false,
      };
    case "failed":
      return {
        heading: "Payment failed",
        message:
          "The hosted payment attempt failed. You can retry from this page without losing your saved draft.",
        isAwaitingPayment: false,
      };
    case "waiting":
      return {
        heading: "Waiting for payment confirmation",
        message:
          "Ripple has your hosted checkout open. This page waits for the webhook to confirm the charge. Ripple does not redirect back here.",
        isAwaitingPayment: true,
      };
    case "opened":
      return {
        heading: "Checkout opened in a new tab",
        message:
          "Your hosted payment opened in a separate tab so this site tab keeps your saved draft and uploaded images intact.",
        isAwaitingPayment: true,
      };
    case "cancelled":
      return {
        heading: "Checkout cancelled",
        message:
          "The hosted payment was cancelled, but your saved draft and uploaded images are still waiting for you here in itrader.",
        isAwaitingPayment: false,
      };
  }
}

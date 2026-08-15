import type { ProviderWebhookEventType } from "@/lib/payments/provider-types";

const CONSERVATIVE_EVENTS = new Set<ProviderWebhookEventType>([
  "payment.failed",
  "subscription.cancelled",
  "subscription.paused",
]);

export type ProviderEventDecision =
  | "apply"
  | "duplicate"
  | "stale"
  | "keep-conservative";

export function decideProviderEventApplication(input: {
  existingAt: Date | null | undefined;
  existingType: string | null | undefined;
  existingFingerprint: string | null | undefined;
  incomingAt: Date;
  incomingType: ProviderWebhookEventType;
  incomingFingerprint: string;
}): ProviderEventDecision {
  if (
    input.existingFingerprint &&
    input.existingFingerprint === input.incomingFingerprint
  ) {
    return "duplicate";
  }
  if (!input.existingAt) return "apply";

  if (input.incomingAt.getTime() < input.existingAt.getTime()) {
    return "stale";
  }
  if (input.incomingAt.getTime() > input.existingAt.getTime()) {
    return "apply";
  }

  if (input.existingType === input.incomingType) {
    return "duplicate";
  }

  const incomingConservative = CONSERVATIVE_EVENTS.has(input.incomingType);
  const existingConservative = CONSERVATIVE_EVENTS.has(
    input.existingType as ProviderWebhookEventType
  );
  if (incomingConservative && !existingConservative) return "apply";
  return "keep-conservative";
}

import { z } from "zod";

export const PAYMENT_RETURN_STORAGE_KEY = "iomarket-payment-return";
export const PAYMENT_RETURN_ACK_STORAGE_KEY = "iomarket-payment-return-ack";
export const PAYMENT_UPDATE_STORAGE_KEY = "itrader:payment-update";
export const PAYMENT_RETURN_ACK_TIMEOUT_MS = 4_000;

const paymentReturnEventSchema = z
  .object({
    id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
    status: z.enum(["success", "cancel", "failed"]),
    context: z.enum(["listing", "featured", "subscription"]),
    listingId: z.string().min(1).max(100).optional(),
    sampleCheckoutId: z.string().regex(/^[a-z0-9]{20,32}$/i).optional(),
    at: z.number().int().positive(),
  })
  .strict();

export type PaymentReturnEvent = z.infer<typeof paymentReturnEventSchema>;
export type PaymentReturnContext = PaymentReturnEvent["context"];
export type PaymentReturnStatus = PaymentReturnEvent["status"];

export type HostedCheckoutLink = {
  status: "confirmed" | "waiting" | "review" | "sign-in" | "failed";
  context?: PaymentReturnContext;
  listingId?: string;
};

export function createPaymentReturnEvent(input: {
  status: PaymentReturnStatus;
  context: PaymentReturnContext;
  listingId?: string;
  sampleCheckoutId?: string;
  at?: number;
  id?: string;
}): PaymentReturnEvent {
  return paymentReturnEventSchema.parse({
    id: input.id ?? crypto.randomUUID(),
    status: input.status,
    context: input.context,
    at: input.at ?? Date.now(),
    ...(input.listingId ? { listingId: input.listingId } : {}),
    ...(input.sampleCheckoutId ? { sampleCheckoutId: input.sampleCheckoutId } : {}),
  });
}

export function parsePaymentReturnEvent(value: string | null | undefined): PaymentReturnEvent | null {
  if (!value) return null;
  try {
    const parsed = paymentReturnEventSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function isMatchingConfirmedLink(
  event: PaymentReturnEvent,
  link: HostedCheckoutLink,
) {
  if (event.status !== "success" || link.status !== "confirmed" || link.context !== event.context) {
    return false;
  }
  if (event.context === "subscription") return true;
  return Boolean(event.listingId) && event.listingId === link.listingId;
}

export function shouldAcknowledgeCheckoutHandoff(input: {
  event: PaymentReturnEvent;
  sampleStatus?: string | null;
  link?: HostedCheckoutLink | null;
}) {
  if (input.event.status !== "success") return false;
  if (input.event.sampleCheckoutId) return input.sampleStatus === "SUCCEEDED";
  if (!input.link) return false;
  return isMatchingConfirmedLink(input.event, input.link);
}

export function publishCheckoutHandoff(event: PaymentReturnEvent): boolean {
  try {
    const serialized = JSON.stringify(paymentReturnEventSchema.parse(event));
    window.localStorage.setItem(PAYMENT_RETURN_STORAGE_KEY, serialized);
    window.localStorage.setItem(PAYMENT_UPDATE_STORAGE_KEY, String(event.at));
    return true;
  } catch {
    return false;
  }
}

export function acknowledgeCheckoutHandoff(eventId: string) {
  const parsed = paymentReturnEventSchema.shape.id.safeParse(eventId);
  if (!parsed.success) return;
  try {
    window.localStorage.setItem(PAYMENT_RETURN_ACK_STORAGE_KEY, parsed.data);
  } catch {
    // The checkout tab keeps its success fallback when storage is unavailable.
  }
}

export function hasCheckoutHandoffAck(eventId: string) {
  try {
    return window.localStorage.getItem(PAYMENT_RETURN_ACK_STORAGE_KEY) === eventId;
  } catch {
    return false;
  }
}

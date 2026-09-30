import { buildAdminListHref, parseAdminEnum } from "@/lib/admin/table-state";

export const PAYMENT_STATUS_FILTERS = ["SUCCEEDED", "PENDING", "FAILED", "REFUNDED"] as const;
export const SUBSCRIPTION_STATUS_FILTERS = ["ACTIVE", "PAST_DUE", "CANCELLED", "INCOMPLETE"] as const;
export const PAYMENT_TYPE_FILTERS = ["LISTING", "FEATURED", "SUPPORT"] as const;

export type PaymentStatusFilter = (typeof PAYMENT_STATUS_FILTERS)[number];
export type SubscriptionStatusFilter = (typeof SUBSCRIPTION_STATUS_FILTERS)[number];
export type PaymentTypeFilter = (typeof PAYMENT_TYPE_FILTERS)[number];

export function parsePaymentStatus(value: string | undefined) {
  return parseAdminEnum(value, PAYMENT_STATUS_FILTERS);
}

export function parseSubscriptionStatus(value: string | undefined) {
  return parseAdminEnum(value, SUBSCRIPTION_STATUS_FILTERS);
}

export function parsePaymentType(value: string | undefined) {
  return parseAdminEnum(value, PAYMENT_TYPE_FILTERS);
}

export function adminPaymentTabHref(
  current: Record<string, string | undefined>,
  tab: string,
) {
  return buildAdminListHref("/admin/payments", current, {
    tab,
    page: "1",
    sort: undefined,
    dir: undefined,
    status: undefined,
    type: undefined,
  });
}

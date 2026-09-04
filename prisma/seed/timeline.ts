import { LISTING_DURATION_DAYS } from "../../lib/listing-status";

type TimelineStatus =
  | "LIVE"
  | "SOLD"
  | "EXPIRED"
  | "DRAFT"
  | "PENDING"
  | "APPROVED"
  | "TAKEN_DOWN"
  | "REJECTED";

export const LIVE_MAX_AGE_DAYS = 55;
export const HISTORY_SPAN_DAYS = 350;

export function liveCreatedDaysAgo(index: number) {
  return 1 + (index % LIVE_MAX_AGE_DAYS);
}

export function soldCreatedDaysAgo(index: number) {
  return 40 + ((index * 17) % (HISTORY_SPAN_DAYS - 40));
}

export function expiredCreatedDaysAgo(index: number) {
  return 70 + ((index * 13) % (HISTORY_SPAN_DAYS - 70));
}

export function soldDaysAgoFor(createdDaysAgo: number, index: number) {
  const minSold = 3;
  const maxSold = Math.max(minSold, createdDaysAgo - 7);
  return minSold + (index % Math.max(1, maxSold - minSold + 1));
}

export function expiresOffsetDays(input: {
  status: TimelineStatus;
  createdDaysAgo: number;
}) {
  if (input.status === "EXPIRED") {
    return -(input.createdDaysAgo - LISTING_DURATION_DAYS + 2);
  }
  if (input.status === "LIVE") {
    return LISTING_DURATION_DAYS - input.createdDaysAgo;
  }
  if (input.status === "SOLD") {
    return LISTING_DURATION_DAYS - 8;
  }
  return null;
}

export function viewCountFor(createdDaysAgo: number, status: TimelineStatus) {
  const base = status === "LIVE" ? 6 : 18;
  return base + createdDaysAgo * 2 + (createdDaysAgo % 17);
}

export function accountDaysAgo(index: number) {
  return 200 + ((index * 11) % 160);
}

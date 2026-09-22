import { isValidTransition } from "../../lib/listing-status";
import type { ListingStatus } from "./dataset";

export interface PlannedStatusEvent {
  toStatus: ListingStatus;
  action:
    | "RETURN_TO_DRAFT"
    | "SUBMIT"
    | "REJECT"
    | "APPROVE"
    | "TAKE_DOWN"
    | "EXPIRE"
    | "MARK_SOLD";
}

export function listingStatusEvents(status: ListingStatus): PlannedStatusEvent[] {
  if (status === "DRAFT") return [{ toStatus: "DRAFT", action: "RETURN_TO_DRAFT" }];
  if (status === "PENDING") return [{ toStatus: "PENDING", action: "SUBMIT" }];
  if (status === "REJECTED") {
    return [
      { toStatus: "PENDING", action: "SUBMIT" },
      { toStatus: "REJECTED", action: "REJECT" },
    ];
  }
  if (status === "TAKEN_DOWN") {
    return [
      { toStatus: "PENDING", action: "SUBMIT" },
      { toStatus: "LIVE", action: "APPROVE" },
      { toStatus: "TAKEN_DOWN", action: "TAKE_DOWN" },
    ];
  }
  if (status === "EXPIRED") {
    return [
      { toStatus: "PENDING", action: "SUBMIT" },
      { toStatus: "LIVE", action: "APPROVE" },
      { toStatus: "EXPIRED", action: "EXPIRE" },
    ];
  }
  if (status === "SOLD") {
    return [
      { toStatus: "PENDING", action: "SUBMIT" },
      { toStatus: "LIVE", action: "APPROVE" },
      { toStatus: "SOLD", action: "MARK_SOLD" },
    ];
  }
  return [
    { toStatus: "PENDING", action: "SUBMIT" },
    { toStatus: "LIVE", action: "APPROVE" },
  ];
}

export function assertStatusEventChain(status: ListingStatus) {
  const events = listingStatusEvents(status);
  let from: ListingStatus | null = null;
  for (const event of events) {
    if (from && !isValidTransition(from, event.toStatus)) {
      throw new Error(`Invalid seed transition ${from} -> ${event.toStatus} for ${status}.`);
    }
    from = event.toStatus;
  }
  if (from !== status) {
    throw new Error(`Status-event chain for ${status} ends at ${from}.`);
  }
  return events;
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 3_600_000);
}

export function listingStatusEventTimes(input: {
  status: ListingStatus;
  createdAt: Date;
  soldAt: Date | null;
  expiresAt: Date | null;
  now: Date;
}) {
  const events = assertStatusEventChain(input.status);
  return events.map((event, index) => {
    if (index === 0) return input.createdAt;
    if (index === events.length - 1) {
      if (input.status === "SOLD" && input.soldAt) return input.soldAt;
      if (input.status === "EXPIRED" && input.expiresAt) return input.expiresAt;
      if (input.status === "LIVE") return addHours(input.createdAt, 6);
    }
    const next = addHours(input.createdAt, 4 * index);
    return next > input.now ? input.now : next;
  });
}

export function assertStatusEventTimes(times: Date[], createdAt: Date) {
  if (times.length === 0) throw new Error("Status-event times are empty.");
  if (times[0].getTime() !== createdAt.getTime()) {
    throw new Error("First status-event time must match listing createdAt.");
  }
  for (let index = 1; index < times.length; index += 1) {
    if (times[index].getTime() < times[index - 1].getTime()) {
      throw new Error("Status-event times must be in non-decreasing order.");
    }
  }
}

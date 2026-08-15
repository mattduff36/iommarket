import type { ListingStatus } from "@prisma/client";

export type ApprovedBackfillTarget = Extract<ListingStatus, "LIVE" | "PENDING">;

export function classifyApprovedBackfill(
  expiresAt: Date | null,
  now = new Date(),
): ApprovedBackfillTarget {
  if (expiresAt !== null && expiresAt > now) {
    return "LIVE";
  }
  return "PENDING";
}

export function classifyTakenDownBackfill(
  latestInboundFromStatus: ListingStatus | null,
): Extract<ListingStatus, "REJECTED"> | null {
  return latestInboundFromStatus === "PENDING" ? "REJECTED" : null;
}

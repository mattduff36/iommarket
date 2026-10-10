import type { Prisma } from "@prisma/client";
import type { TakeDownRequest } from "../../lib/dealer-stock-sync/apply";

export async function takeDownManagedListing(
  client: Prisma.TransactionClient,
  request: TakeDownRequest,
) {
  const { transitionListingStatus } = await import("../../lib/listings/status-events");
  await transitionListingStatus(
    {
      listingId: request.listingId,
      action: "TAKE_DOWN",
      expectedRevision: request.expectedRevision,
      actor: { id: request.actorId, role: "ADMIN" },
      source: "ADMIN",
      reasonCode: "OTHER",
      notes: request.notes,
    },
    client,
  );
}

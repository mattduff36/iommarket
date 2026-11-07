"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDealerStockSyncAvailability } from "@/lib/deployment/dealer-stock-sync";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";
import { rateLimitActionError } from "@/lib/rate-limit-result";
import { reportHandledException } from "@/lib/monitoring";
import { ListingLifecycleError } from "@/lib/listings/errors";
import { changeStockDraftOwnership, stockDraftOwnershipSchema, StockDraftRecallError } from "@/lib/dealer-stock-sync/draft-recall";

export async function reviewDealerStockDraftOwnership(input: unknown) {
  const admin = await requireRole("ADMIN");
  const availability = getDealerStockSyncAvailability();
  if (!availability.enabled) return { error: availability.reason };
  const limited = rateLimitActionError(await checkRateLimit(makeRateLimitKey("admin-stock-draft-ownership", admin.id),
    { maxRequests: 30, windowMs: 60_000, policy: "dealer-stock-sync" }), "Too many stock review requests. Try again shortly.");
  if (limited) return { error: limited };
  const parsed = stockDraftOwnershipSchema.safeParse(input);
  if (!parsed.success) return { error: "Refresh this stock review and confirm the action before continuing." };
  try {
    const data = await db.$transaction(tx => changeStockDraftOwnership(tx, parsed.data, admin),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
    for (const path of ["/admin/stock-reviews", `/admin/dealers/${data.dealerId}/stock-sync`, "/admin/listings",
      "/account/listings", "/dealer/listings", "/dealer/dashboard", `/listings/${data.listingId}`, "/sell/dealer"]) revalidatePath(path);
    return { data };
  } catch (error) {
    if (error instanceof StockDraftRecallError || error instanceof ListingLifecycleError) return { error: error.message };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return { error: "This draft changed during the action. Refresh and check its saved state before retrying." };
    }
    await reportHandledException({ error, action: "reviewDealerStockDraftOwnership", route: "/admin/stock-reviews", userId: admin.id });
    return { error: "The draft ownership change could not be confirmed. Refresh the review before retrying." };
  }
}

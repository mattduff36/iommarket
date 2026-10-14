"use server";

import { revalidatePath } from "next/cache";
import type { TradeListingStatus } from "@prisma/client";
import { decideTradeMembership } from "@/lib/trade-exchange/membership";
import { changeTradeListingStatus } from "@/lib/trade-exchange/listings";
import { resolveTradeReport } from "@/lib/trade-exchange/reports";
import { loadTradeSession } from "@/lib/trade-exchange/session";

async function adminActor() {
  const session = await loadTradeSession();
  if (session.actor.kind !== "admin") return null;
  return session.actor;
}

export async function decideTradeMembershipAction(formData: FormData) {
  const actor = await adminActor();
  if (!actor) return { error: "Not found." };
  const result = await decideTradeMembership({
    adminUserId: actor.userId,
    values: {
      membershipId: formData.get("membershipId"),
      decision: formData.get("decision"),
      reasonCode: formData.get("reasonCode") || undefined,
      note: formData.get("note"),
    },
  });
  if ("ok" in result) revalidatePath("/admin/trade");
  return result;
}

export async function adminTradeListingStatusAction(listingId: string, status: TradeListingStatus) {
  const actor = await adminActor();
  if (!actor) return { error: "Not found." };
  const result = await changeTradeListingStatus({ actor, listingId, to: status });
  if ("ok" in result) revalidatePath("/admin/trade/listings");
  return result;
}

export async function resolveTradeReportAction(reportId: string, decision: "RESOLVED" | "REJECTED") {
  const actor = await adminActor();
  if (!actor) return { error: "Not found." };
  const result = await resolveTradeReport(actor.userId, reportId, decision);
  if ("ok" in result) revalidatePath("/admin/trade/reports");
  return result;
}

"use server";

import { revalidatePath } from "next/cache";
import type { TradeEnquiryStatus } from "@prisma/client";
import { changeTradeEnquiryStatus, replyToTradeEnquiry, sendTradeEnquiry } from "@/lib/trade-exchange/enquiries";
import { loadTradeSession } from "@/lib/trade-exchange/session";
import { poundsToPence } from "@/lib/trade-exchange/form";

export async function sendTradeEnquiryAction(formData: FormData) {
  const session = await loadTradeSession();
  if (session.actor.kind !== "member") return { error: "Not found." };
  const result = await sendTradeEnquiry(session.actor, {
    listingId: formData.get("listingId"),
    body: formData.get("body"),
    offerPence: poundsToPence(String(formData.get("offerGbp") ?? "")),
  });
  if ("id" in result && result.ok) revalidatePath(`/dealer/trade/enquiries/${result.id}`);
  return result;
}

export async function replyTradeEnquiryAction(enquiryId: string, formData: FormData) {
  const session = await loadTradeSession();
  if (session.actor.kind !== "member") return { error: "Not found." };
  const result = await replyToTradeEnquiry(session.actor, enquiryId, String(formData.get("body") ?? ""));
  if ("ok" in result) revalidatePath(`/dealer/trade/enquiries/${enquiryId}`);
  return result;
}

export async function tradeEnquiryStatusAction(enquiryId: string, status: TradeEnquiryStatus) {
  const session = await loadTradeSession();
  if (session.actor.kind !== "member") return { error: "Not found." };
  const result = await changeTradeEnquiryStatus(session.actor, enquiryId, status);
  if ("ok" in result) revalidatePath(`/dealer/trade/enquiries/${enquiryId}`);
  return result;
}

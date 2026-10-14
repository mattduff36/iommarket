"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addTradePhoto, removeTradePhoto } from "@/lib/trade-exchange/images";
import { changeTradeListingStatus, createTradeDraft, importTradeDrafts, publishTradeListing, updateTradeListing } from "@/lib/trade-exchange/listings";
import { reportTradeListing } from "@/lib/trade-exchange/reports";
import { deleteTradeSearch, saveTradeSearch } from "@/lib/trade-exchange/saved-searches";
import { listingInputFromForm, searchInputFromForm } from "@/lib/trade-exchange/form";
import { loadTradeSession } from "@/lib/trade-exchange/session";
import { TRADE_MAX_IMAGE_BYTES } from "@/lib/trade-exchange/constants";

async function memberSession() {
  const session = await loadTradeSession();
  if (session.actor.kind !== "member" && session.actor.kind !== "admin") return null;
  return session;
}

export async function createTradeListingAction(formData: FormData) {
  const session = await memberSession();
  if (!session || session.actor.kind !== "member") return { error: "Not found." };
  const result = await createTradeDraft(session.actor, listingInputFromForm(formData));
  if ("id" in result && result.ok) redirect(`/dealer/trade/listings/${result.id}`);
  return result;
}

export async function updateTradeListingAction(listingId: string, formData: FormData) {
  const session = await memberSession();
  if (!session) return { error: "Not found." };
  const result = await updateTradeListing(session.actor, listingId, listingInputFromForm(formData));
  if ("ok" in result) {
    revalidatePath(`/dealer/trade/listings/${listingId}`);
    redirect(`/dealer/trade/listings/${listingId}`);
  }
  return result;
}

export async function publishTradeListingAction(listingId: string) {
  const session = await memberSession();
  if (!session || session.actor.kind !== "member") return { error: "Not found." };
  const result = await publishTradeListing(session.actor, listingId);
  revalidatePath("/dealer/trade");
  return result;
}

export async function tradeListingStatusAction(listingId: string, status: "RESERVED" | "LIVE" | "SOLD" | "WITHDRAWN" | "REMOVED") {
  const session = await memberSession();
  if (!session || session.actor.kind !== "member") return { error: "Not found." };
  const result = await changeTradeListingStatus({ actor: session.actor, listingId, to: status });
  revalidatePath("/dealer/trade");
  return result;
}

export async function uploadTradePhotoAction(listingId: string, formData: FormData) {
  const session = await memberSession();
  if (!session) return { error: "Not found." };
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0 || file.size > TRADE_MAX_IMAGE_BYTES) {
    return { error: "Use a JPG, PNG, or WebP photo under 10 MB." };
  }
  const result = await addTradePhoto(session.actor, listingId, Buffer.from(await file.arrayBuffer()));
  if ("ok" in result) revalidatePath(`/dealer/trade/listings/${listingId}`);
  return result;
}

export async function removeTradePhotoAction(imageId: string) {
  const session = await memberSession();
  if (!session) return { error: "Not found." };
  const result = await removeTradePhoto(session.actor, imageId);
  revalidatePath("/dealer/trade");
  return result;
}

export async function reportTradeListingAction(formData: FormData) {
  const session = await memberSession();
  if (!session || session.actor.kind !== "member") return { error: "Not found." };
  const result = await reportTradeListing(session.actor, {
    listingId: formData.get("listingId"),
    reasonCode: formData.get("reasonCode"),
    details: formData.get("details"),
  });
  return result;
}

export async function importTradeListingsAction(formData: FormData) {
  const session = await memberSession();
  if (!session || session.actor.kind !== "member") return { error: "Not found." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file." };
  const result = await importTradeDrafts(session.actor, await file.text());
  if ("ok" in result && result.errors) {
    revalidatePath("/dealer/trade/stock");
    if (result.errors.length > 0) {
      return { error: `${result.createdCount} drafts imported. ${result.errors.length} rows need attention.` };
    }
  }
  return result;
}

export async function saveTradeSearchAction(formData: FormData) {
  const session = await memberSession();
  if (!session || session.actor.kind !== "member") return { error: "Not found." };
  const result = await saveTradeSearch(session.actor, String(formData.get("name") ?? ""), searchInputFromForm(formData));
  if ("ok" in result) revalidatePath("/dealer/trade/saved");
  return result;
}

export async function deleteTradeSearchAction(searchId: string) {
  const session = await memberSession();
  if (!session || session.actor.kind !== "member") return { error: "Not found." };
  const result = await deleteTradeSearch(session.actor, searchId);
  if ("ok" in result) revalidatePath("/dealer/trade/saved");
  return result;
}

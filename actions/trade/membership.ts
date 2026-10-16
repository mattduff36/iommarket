"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { submitTradeApplication } from "@/lib/trade-exchange/membership";
import { loadTradeSession } from "@/lib/trade-exchange/session";
import { TRADE_MAX_EVIDENCE_BYTES } from "@/lib/trade-exchange/constants";

export async function submitTradeApplicationAction(formData: FormData) {
  const session = await loadTradeSession();
  if (!session.email || (session.actor.kind !== "applicant" && session.actor.kind !== "member")) {
    return { error: "Not found." };
  }
  const file = formData.get("evidence");
  let evidence: { bytes: Buffer; fileName: string } | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > TRADE_MAX_EVIDENCE_BYTES) return { error: "Evidence must be under 8 MB." };
    evidence = { bytes: Buffer.from(await file.arrayBuffer()), fileName: file.name };
  }
  const result = await submitTradeApplication({
    actor: session.actor,
    accountEmail: session.email,
    evidence,
    values: {
      businessName: formData.get("businessName"),
      legalEntityName: formData.get("legalEntityName"),
      entityType: formData.get("entityType"),
      registrationIdentifier: formData.get("registrationIdentifier"),
      tradingAddress: formData.get("tradingAddress"),
      website: formData.get("website"),
      contactName: formData.get("contactName"),
      roleDeclaration: formData.get("roleDeclaration"),
      workEmail: formData.get("workEmail"),
      phone: formData.get("phone"),
      activityDescription: formData.get("activityDescription"),
      authorityConfirmed: formData.get("authorityConfirmed") === "on",
    },
  });
  if ("ok" in result) {
    revalidatePath("/dealer/trade");
    redirect("/dealer/trade");
  }
  return result;
}

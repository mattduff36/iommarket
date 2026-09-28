"use server";

import { revalidatePath } from "next/cache";
import { acceptPendingDealerUpgradeOffer } from "@/lib/dealers/upgrade-offers";
import { captureException } from "@/lib/monitoring";
import { requireAcceptedAuth } from "@/lib/policy/gate";
import {
  acceptDealerUpgradeSchema,
  type AcceptDealerUpgradeInput,
} from "@/lib/validations/dealer-upgrade";

export async function acceptDealerUpgrade(input: AcceptDealerUpgradeInput) {
  const user = await requireAcceptedAuth();
  const parsed = acceptDealerUpgradeSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  try {
    const result = await acceptPendingDealerUpgradeOffer({
      userId: user.id,
      offerId: parsed.data.offerId,
      policyDigest: parsed.data.policyDigest,
    });
    if (result.kind === "not-pending") {
      return { error: "This dealer upgrade offer is no longer available." };
    }
    if (result.kind === "unavailable") {
      return { error: "This account cannot activate a dealer upgrade." };
    }
    if (result.kind === "policy-changed") {
      return {
        error:
          "The dealer documents changed while you were reviewing them. Refresh the page and review the current versions.",
      };
    }
    if (
      result.kind === "role-conflict" ||
      result.kind === "paid-conflict" ||
      result.kind === "admin-grant-conflict"
    ) {
      return {
        error:
          "Your account access changed after this offer was created. Contact support before continuing.",
      };
    }

    revalidatePath("/account");
    revalidatePath("/account/dealer-upgrade");
    revalidatePath("/dealer/dashboard");
    revalidatePath("/dealer/profile");
    revalidatePath("/sell/dealer");
    return { data: { success: true, alreadyAccepted: result.kind === "already-accepted" } };
  } catch (error) {
    await captureException({
      source: "SERVER",
      error,
      action: "acceptDealerUpgrade",
      route: "/account/dealer-upgrade",
      requestPath: "/account/dealer-upgrade",
      userId: user.id,
    });
    return { error: "Unable to activate the dealer upgrade. Please try again." };
  }
}

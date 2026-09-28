"use server";

import { revalidatePath } from "next/cache";
import { logAdminAction } from "@/lib/admin/audit";
import { requireRole } from "@/lib/auth";
import {
  cancelPendingDealerUpgradeOffer,
  deliverDealerUpgradeOffer,
  findPendingDealerUpgradeOfferById,
} from "@/lib/dealers/upgrade-offers";
import { captureException } from "@/lib/monitoring";
import {
  dealerUpgradeOfferActionSchema,
  type DealerUpgradeOfferActionInput,
} from "@/lib/validations/admin";

function revalidateUpgradeOfferPaths(userId: string) {
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/account");
  revalidatePath("/account/dealer-upgrade");
}

export async function resendDealerUpgradeOffer(
  input: DealerUpgradeOfferActionInput,
) {
  const admin = await requireRole("ADMIN");
  const parsed = dealerUpgradeOfferActionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  try {
    const offer = await findPendingDealerUpgradeOfferById(parsed.data.offerId);
    if (!offer) return { error: "No pending dealer upgrade offer exists." };
    const delivery = await deliverDealerUpgradeOffer(offer.id);
    if (delivery.kind !== "sent") {
      return { error: "The offer is still pending, but the email could not be sent." };
    }
    await logAdminAction({
      adminId: admin.id,
      action: "RESEND_DEALER_UPGRADE_OFFER",
      entityType: "DealerUpgradeOffer",
      entityId: offer.id,
      details: { userId: offer.userId },
    });
    revalidateUpgradeOfferPaths(offer.userId);
    return { data: { success: true } };
  } catch (error) {
    await captureException({
      source: "SERVER",
      error,
      action: "resendDealerUpgradeOffer",
      route: "/admin/users",
      requestPath: "/admin/users",
      userId: admin.id,
      tags: { offerId: parsed.data.offerId },
    });
    return { error: "Unable to resend the dealer upgrade offer." };
  }
}

export async function cancelDealerUpgradeOffer(
  input: DealerUpgradeOfferActionInput,
) {
  const admin = await requireRole("ADMIN");
  const parsed = dealerUpgradeOfferActionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  try {
    const offer = await findPendingDealerUpgradeOfferById(parsed.data.offerId);
    if (!offer) return { error: "No pending dealer upgrade offer exists." };
    const result = await cancelPendingDealerUpgradeOffer(
      offer.id,
      admin.id,
    );
    if (result.count === 0) {
      return { error: "No pending dealer upgrade offer exists." };
    }
    await logAdminAction({
      adminId: admin.id,
      action: "CANCEL_DEALER_UPGRADE_OFFER",
      entityType: "DealerUpgradeOffer",
      entityId: offer.id,
      details: { userId: offer.userId },
    });
    revalidateUpgradeOfferPaths(offer.userId);
    return { data: { success: true } };
  } catch (error) {
    await captureException({
      source: "SERVER",
      error,
      action: "cancelDealerUpgradeOffer",
      route: "/admin/users",
      requestPath: "/admin/users",
      userId: admin.id,
      tags: { offerId: parsed.data.offerId },
    });
    return { error: "Unable to cancel the dealer upgrade offer." };
  }
}

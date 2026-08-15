"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAcceptedAuth } from "@/lib/policy/gate";
import { hasDealerDashboardAccess } from "@/lib/dealers/access";
import {
  CancellationError,
  createDealerCancellationRequest,
} from "@/lib/policy/cancellation";
import { sendCancellationStatusEmail } from "@/lib/email/cancellation-notifications";
import { requestDealerCancellationSchema } from "@/lib/validations/cancellation";

export async function requestDealerCancellation(input: { confirmation: boolean }) {
  const user = await requireAcceptedAuth();
  if (!hasDealerDashboardAccess(user) || !user.dealerProfile) {
    return { error: "Not authorized to request dealer cancellation." };
  }

  const parsed = requestDealerCancellationSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  try {
    const result = await createDealerCancellationRequest({
      dealerId: user.dealerProfile.id,
      requestedByUserId: user.id,
    });
    if (result.created) {
      await sendCancellationStatusEmail({
        to: user.email,
        dealerName: user.dealerProfile.name,
        status: result.request.status,
        periodEndAt: result.request.periodEndAt,
      });
    }
    revalidatePath("/dealer/dashboard");
    return { data: { id: result.request.id, status: result.request.status } };
  } catch (error) {
    if (error instanceof CancellationError) {
      return { error: error.message };
    }
    const message =
      error instanceof Error ? error.message : "Failed to request cancellation";
    return { error: message };
  }
}

export async function getDealerCancellationRequest(dealerId: string) {
  return db.dealerCancellationRequest.findFirst({
    where: {
      dealerId,
      status: { in: ["REQUESTED", "ACKNOWLEDGED", "RECONCILED"] },
    },
    orderBy: { requestedAt: "desc" },
  });
}

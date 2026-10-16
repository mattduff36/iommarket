"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAcceptedAuth } from "@/lib/policy/gate";
import { hasDealerDashboardAccess } from "@/lib/dealers/access";
import { createDealerCancellationRequest } from "@/lib/policy/cancellation";
import { sendCancellationStatusEmail } from "@/lib/email/cancellation-notifications";
import { resolveDealerMailRecipients } from "@/lib/dealers/correspondence-routing";
import { requestDealerCancellationSchema } from "@/lib/validations/cancellation";
import { journeyUnknownResult } from "@/lib/forms/journey-public-error";
import { cancellationPublicMessage } from "@/lib/forms/known-domain-messages";

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
      const recipients = await resolveDealerMailRecipients({
        dealerId: user.dealerProfile.id,
        primaryEmail: user.email,
        category: "SUBSCRIPTION",
      });
      if (recipients.length > 0) {
        await sendCancellationStatusEmail({
          to: recipients,
          dealerName: user.dealerProfile.name,
          status: result.request.status,
          periodEndAt: result.request.periodEndAt,
        });
      }
    }
    revalidatePath("/dealer/dashboard");
    return { data: { id: result.request.id, status: result.request.status } };
  } catch (error) {
    const known = cancellationPublicMessage(error);
    if (known) return { error: known };
    return journeyUnknownResult({
      error,
      journey: "dealer-admin",
      action: "requestDealerCancellation",
      route: "/dealer/dashboard",
      kind: "destructive",
      message: "We couldn't confirm that this cancellation request finished. Check the dealer dashboard before trying again.",
      userId: user.id,
    });
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

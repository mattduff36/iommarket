"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { transitionDealerCancellationRequest } from "@/lib/policy/cancellation";
import { sendCancellationStatusEmail } from "@/lib/email/cancellation-notifications";
import { resolveDealerMailRecipients } from "@/lib/dealers/correspondence-routing";
import { staffCancellationActionSchema } from "@/lib/validations/cancellation";
import { journeyUnknownResult } from "@/lib/forms/journey-public-error";
import { cancellationPublicMessage } from "@/lib/forms/known-domain-messages";

const ACTION_TO_STATUS = {
  ACKNOWLEDGE: "ACKNOWLEDGED",
  RECONCILE: "RECONCILED",
  REJECT: "REJECTED",
  COMPLETE: "COMPLETED",
} as const;

export async function processDealerCancellationRequest(input: {
  requestId: string;
  action: "ACKNOWLEDGE" | "RECONCILE" | "REJECT" | "COMPLETE";
  notes?: string;
}) {
  const admin = await requireRole("ADMIN");
  const parsed = staffCancellationActionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  try {
    const result = await transitionDealerCancellationRequest({
      requestId: parsed.data.requestId,
      toStatus: ACTION_TO_STATUS[parsed.data.action],
      actorUserId: admin.id,
      source: "STAFF",
      notes: parsed.data.notes,
    });
    const request = await db.dealerCancellationRequest.findUnique({
      where: { id: result.request.id },
      include: {
        dealer: {
          select: { id: true, name: true, user: { select: { email: true } } },
        },
      },
    });
    if (request) {
      const recipients = await resolveDealerMailRecipients({
        dealerId: request.dealer.id,
        primaryEmail: request.dealer.user.email,
        category: "SUBSCRIPTION",
      });
      if (recipients.length > 0) {
        await sendCancellationStatusEmail({
          to: recipients,
          dealerName: request.dealer.name,
          status: request.status,
          periodEndAt: request.periodEndAt,
        });
      }
    }
    revalidatePath("/admin/cancellations");
    revalidatePath("/admin/payments");
    revalidatePath("/dealer/dashboard");
    return { data: { id: result.request.id, status: result.request.status } };
  } catch (error) {
    const known = cancellationPublicMessage(error);
    if (known) return { error: known };
    return journeyUnknownResult({
      error,
      journey: "dealer-admin",
      action: "processDealerCancellationRequest",
      route: "/admin/cancellations",
      kind: "destructive",
      message: "We couldn't confirm that this cancellation change finished. Check the request before trying again.",
      userId: admin.id,
    });
  }
}

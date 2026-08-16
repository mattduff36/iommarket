"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import {
  CancellationError,
  transitionDealerCancellationRequest,
} from "@/lib/policy/cancellation";
import { sendCancellationStatusEmail } from "@/lib/email/cancellation-notifications";
import { staffCancellationActionSchema } from "@/lib/validations/cancellation";
import { reportHandledException } from "@/lib/monitoring";

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
        dealer: { select: { name: true, user: { select: { email: true } } } },
      },
    });
    if (request) {
      await sendCancellationStatusEmail({
        to: request.dealer.user.email,
        dealerName: request.dealer.name,
        status: request.status,
        periodEndAt: request.periodEndAt,
      });
    }
    revalidatePath("/admin/cancellations");
    revalidatePath("/admin/payments");
    revalidatePath("/dealer/dashboard");
    return { data: { id: result.request.id, status: result.request.status } };
  } catch (error) {
    if (error instanceof CancellationError) {
      return { error: error.message };
    }
    await reportHandledException({
      error,
      action: "processDealerCancellationRequest",
      route: "/admin/cancellations",
    });
    const message =
      error instanceof Error ? error.message : "Failed to process cancellation";
    return { error: message };
  }
}

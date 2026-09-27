import { costDb } from "@/lib/costs/db";
import { getCostOwnerNotificationEmail } from "@/lib/costs/config";
import { formatMarkedGbp } from "@/lib/costs/format";
import { sendResendEmail } from "@/lib/email/client";
import { getEmailAppOrigin } from "@/lib/email/links";
import { renderBrandedEmail } from "@/lib/email/layout";

export function buildCostInvoiceRequestEmail(input: {
  requestId: string;
  amountLabel: string;
  confirmUrl: string;
}) {
  return {
    subject: `Invoice request for ${input.amountLabel}`,
    ...renderBrandedEmail({
      title: "Invoice request received",
      intro: `An admin requested an invoice for ${input.amountLabel}. Confirming acknowledges that you will raise the invoice for this frozen amount.`,
      details: [
        { label: "Request", value: input.requestId },
        { label: "Amount", value: input.amountLabel },
      ],
      actionHref: input.confirmUrl,
      actionLabel: "Confirm invoice request",
    }),
  };
}

export async function deliverCostOutbox(outboxId: string): Promise<void> {
  const outbox = await costDb.costEmailOutbox.findUnique({
    where: { id: outboxId },
    include: { request: true },
  });
  if (!outbox || outbox.status === "SENT") return;

  const claimed = await costDb.costEmailOutbox.updateMany({
    where: { id: outbox.id, status: { in: ["PENDING", "FAILED"] } },
    data: {
      status: "SENDING",
      claimedAt: new Date(),
      attemptCount: { increment: 1 },
    },
  });
  if (claimed.count !== 1) return;

  try {
    const to = getCostOwnerNotificationEmail();
    const confirmUrl = `${getEmailAppOrigin()}/admin/costs/confirm/${outbox.request.id}`;
    const amountLabel = formatMarkedGbp(outbox.request.frozenGbpMinor);
    const email = buildCostInvoiceRequestEmail({
      requestId: outbox.request.id,
      amountLabel,
      confirmUrl,
    });

    await sendResendEmail({
      to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });

    await costDb.costEmailOutbox.update({
      where: { id: outbox.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        lastError: null,
        providerMessageId: outbox.id,
      },
    });
  } catch (error) {
    await costDb.costEmailOutbox.update({
      where: { id: outbox.id },
      data: {
        status: "FAILED",
        lastError: error instanceof Error ? error.message : "Email delivery failed.",
        nextAttemptAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });
    throw error;
  }
}

export async function retryPendingCostEmails(limit = 20): Promise<number> {
  const pending = await costDb.costEmailOutbox.findMany({
    where: {
      OR: [
        {
          status: { in: ["PENDING", "FAILED"] },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
        },
        {
          status: "SENDING",
          claimedAt: { lte: new Date(Date.now() - 15 * 60 * 1000) },
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let delivered = 0;
  for (const item of pending) {
    try {
      await deliverCostOutbox(item.id);
      delivered += 1;
    } catch {
      // Delivery state is persisted; continue remaining outbox rows.
    }
  }
  return delivered;
}

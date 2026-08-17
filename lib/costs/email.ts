import { db } from "@/lib/db";
import { getCostOwnerNotificationEmail } from "@/lib/costs/config";
import { formatMarkedGbp } from "@/lib/costs/format";
import { sendResendEmail } from "@/lib/email/client";
import { renderBrandedEmail } from "@/lib/email/layout";

export async function deliverCostOutbox(outboxId: string): Promise<void> {
  const outbox = await db.costEmailOutbox.findUnique({
    where: { id: outboxId },
    include: { request: true },
  });
  if (!outbox || outbox.status === "SENT") return;

  const claimed = await db.costEmailOutbox.updateMany({
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
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:4000").replace(/\/$/, "");
    const confirmUrl = `${appUrl}/admin/costs/confirm/${outbox.request.id}`;
    const amountLabel = formatMarkedGbp(outbox.request.frozenGbpMinor);
    const email = renderBrandedEmail({
      title: "Invoice request received",
      intro: `An admin requested an invoice for ${amountLabel}. Confirming acknowledges that you will raise the invoice for this frozen amount.`,
      bodyLines: [
        `Request: ${outbox.request.id}`,
        `Amount: ${amountLabel}`,
        `Confirm: ${confirmUrl}`,
      ],
    });

    await sendResendEmail({
      to,
      subject: `Invoice request for ${amountLabel}`,
      text: email.text,
      html: email.html,
    });

    await db.costEmailOutbox.update({
      where: { id: outbox.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        lastError: null,
        providerMessageId: outbox.id,
      },
    });
  } catch (error) {
    await db.costEmailOutbox.update({
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
  const pending = await db.costEmailOutbox.findMany({
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

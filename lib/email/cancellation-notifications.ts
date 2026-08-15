import { sendResendEmail } from "@/lib/email/client";
import { renderBrandedEmail } from "@/lib/email/layout";
import { captureException } from "@/lib/monitoring";
import type { CancellationRequestStatus } from "@prisma/client";

function copyForStatus(status: CancellationRequestStatus) {
  if (status === "REQUESTED") {
    return {
      subject: "Cancellation request received",
      intro:
        "We have received your request to cancel at the end of the current paid period. Access stays active until that date. Refunds are not pro-rated.",
    };
  }
  if (status === "ACKNOWLEDGED") {
    return {
      subject: "Cancellation request acknowledged",
      intro:
        "Our team has acknowledged your cancellation request and will complete the provider-side change. Access remains active until the paid period ends. This is not an immediate provider cancellation confirmation.",
    };
  }
  if (status === "RECONCILED") {
    return {
      subject: "Cancellation scheduled at period end",
      intro:
        "Your dealer subscription is set to end after the current paid period. You keep access until that date. Refunds are not pro-rated.",
    };
  }
  if (status === "COMPLETED") {
    return {
      subject: "Dealer subscription cancelled",
      intro:
        "Your paid dealer period has ended and the subscription is now cancelled.",
    };
  }
  return {
    subject: "Cancellation request update",
    intro:
      "Your cancellation request could not be completed as submitted. Access is unchanged. Contact hello@itrader.im if you need help.",
  };
}

export async function sendCancellationStatusEmail(input: {
  to: string;
  dealerName: string;
  status: CancellationRequestStatus;
  periodEndAt?: Date | null;
}) {
  try {
    const copy = copyForStatus(input.status);
    const email = renderBrandedEmail({
      title: copy.subject,
      intro: copy.intro,
      bodyLines: [
        `Dealer: ${input.dealerName}`,
        input.periodEndAt
          ? `Paid period ends: ${input.periodEndAt.toLocaleDateString("en-GB")}`
          : "Paid period end: see your dealer dashboard.",
        "See the Refund Policy at /refunds for refund rules.",
      ],
    });
    await sendResendEmail({
      to: input.to,
      subject: copy.subject,
      text: email.text,
      html: email.html,
    });
  } catch (error) {
    try {
      await captureException({
        source: "BUSINESS",
        error,
        severity: "MEDIUM",
        title: "Cancellation email failed",
        action: "sendCancellationStatusEmail",
      });
    } catch {
      // Email is best-effort after a committed cancellation transition.
    }
  }
}

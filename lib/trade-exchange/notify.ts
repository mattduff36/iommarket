import { sendResendEmail } from "@/lib/email/client";
import {
  buildTradeApplicationEmail,
  buildTradeEnquiryEmail,
  buildTradeExpiryEmail,
  buildTradeSavedSearchEmail,
} from "@/lib/trade-exchange/emails";

async function send(to: string, email: { subject: string; html: string; text: string }): Promise<boolean> {
  if (!to.includes("@")) return false;
  try {
    await sendResendEmail({ to, subject: email.subject, html: email.html, text: email.text });
    return true;
  } catch (error) {
    console.error("Trade Exchange email failed", { reason: error instanceof Error ? error.name : "unknown" });
    return false;
  }
}

export function notifyTradeApplication(to: string) {
  return send(to, buildTradeApplicationEmail());
}

export function notifyTradeEnquiry(to: string) {
  return send(to, buildTradeEnquiryEmail());
}

export function notifyTradeExpiry(to: string) {
  return send(to, buildTradeExpiryEmail());
}

export function notifyTradeSavedSearch(to: string, matchCount: number): Promise<boolean> {
  return send(to, buildTradeSavedSearchEmail(matchCount));
}

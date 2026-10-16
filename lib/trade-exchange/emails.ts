import { renderBrandedEmail } from "@/lib/email/layout";

const SIGN_IN = "https://itrader.im/dealer/trade";

function tradeNotice(title: string, intro: string) {
  return {
    subject: "Trade Exchange update",
    ...renderBrandedEmail({
      preheader: "Sign in to Trade Exchange.",
      title,
      intro,
      actionHref: SIGN_IN,
      actionLabel: "Open Trade Exchange",
      notice: "This email does not include vehicle or application details. Sign in to read them.",
    }),
  };
}

export function buildTradeApplicationEmail() {
  return tradeNotice(
    "Trade Exchange application update",
    "Your Trade Exchange application has been updated. Sign in to see the next step.",
  );
}

export function buildTradeEnquiryEmail() {
  return tradeNotice(
    "New Trade Exchange enquiry",
    "You have a new Trade Exchange enquiry. Sign in to read it.",
  );
}

export function buildTradeExpiryEmail() {
  return tradeNotice(
    "Trade Exchange availability check",
    "One or more of your trade listings need an availability check. Sign in to confirm or withdraw them.",
  );
}

export function buildTradeSavedSearchEmail(matchCount: number) {
  const count = Math.max(0, Math.trunc(matchCount));
  return tradeNotice(
    "Saved Trade Exchange search",
    count === 1
      ? "There is 1 new trade listing matching a saved search. Sign in to view it."
      : `There are ${count} new trade listings matching a saved search. Sign in to view them.`,
  );
}

export function tradeEmailContains(email: { html: string; text: string }, needle: string): boolean {
  const combined = `${email.html}\n${email.text}`.toLowerCase();
  return combined.includes(needle.toLowerCase());
}

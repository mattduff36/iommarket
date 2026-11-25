import { createHmac, timingSafeEqual } from "node:crypto";
import { buildListingPath } from "@/lib/navigation-paths";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";
import { sendStrictResendEmail } from "@/lib/email/send-strict";
import { getRippleReferenceSecrets } from "@/lib/payments/ripple-config";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";

export type ReceiptCodeInput = "send" | { code: string };

export function featuredReceiptCode(binding: readonly (string | number)[]) {
  const digest = createHmac("sha256", getRippleReferenceSecrets().current)
    .update(JSON.stringify(["featured-receipt-consent-v2", ...binding]))
    .digest();
  return String(digest.readUIntBE(0, 6) % 1_000_000).padStart(6, "0");
}

export function matchesReceiptCode(candidate: string, expected: string) {
  return /^[0-9]{6}$/.test(candidate) &&
    timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}

export async function sendFeaturedReceiptCode(input: {
  to: string; receiptId: string; listingId: string; code: string;
}) {
  const limit = await checkRateLimit(makeRateLimitKey("featured-receipt-code", input.receiptId), {
    windowMs: 30 * 60_000, maxRequests: 3, policy: "featured-receipt-code",
  });
  if (!limit.allowed || limit.unavailable) return false;
  await sendStrictResendEmail({
    to: input.to,
    subject: "Authorise your iTrader Featured listing upgrade",
    text: [
      "Someone has asked to apply your Ripple payment to this iTrader listing:",
      buildCanonicalUrl(buildListingPath(input.listingId)),
      `Listing ID: ${input.listingId}`,
      `If this is the listing you paid to feature, enter ${input.code} on the iTrader payment confirmation page during this checkout.`,
      "If you do not recognise this request, ignore this email and keep the code private.",
    ].join("\n\n"),
  });
  return true;
}

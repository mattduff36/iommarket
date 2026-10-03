import { cookies } from "next/headers";
import { db } from "@/lib/db";
import {
  COOKIE_CONSENT_COOKIE_NAME,
  isMarketingAllowed,
  parseCookieConsent,
} from "@/lib/consent/cookie-consent";
import { parseStoredAttribution } from "@/lib/advertising/attribution";
import { ATTRIBUTION_COOKIE_NAME } from "@/lib/advertising/attribution-cookie";
import { deliverAdvertisingEvents } from "@/lib/advertising/deliver";
import { claimPurchaseDelivery } from "@/lib/advertising/purchase-claim";
import {
  buildServicePurchaseEvent,
  selectServicePurchaseSource,
} from "@/lib/advertising/outcomes";

export async function reportVerifiedServicePurchase(paymentJobRef: string): Promise<void> {
  if (!/^\d{10,30}$/.test(paymentJobRef)) return;
  try {
    const jar = await cookies();
    if (!isMarketingAllowed(parseCookieConsent(jar.get(COOKIE_CONSENT_COOKIE_NAME)?.value))) return;
    const [payment, charge] = await Promise.all([
      db.payment.findUnique({
        where: { providerPaymentId: paymentJobRef },
        select: { id: true, amount: true, currency: true, status: true },
      }),
      db.subscriptionCharge.findUnique({
        where: { paymentReference: paymentJobRef },
        select: { id: true, amount: true, currency: true },
      }),
    ]);
    const source = selectServicePurchaseSource({ payment, charge });
    const event = source ? buildServicePurchaseEvent(source) : null;
    if (!event?.transactionId) return;
    if (!(await claimPurchaseDelivery(event.transactionId))) return;
    const campaignSource = parseStoredAttribution(jar.get(ATTRIBUTION_COOKIE_NAME)?.value)?.last.params.utm_source;
    await deliverAdvertisingEvents([{ ...event, ...(campaignSource ? { campaignSource } : {}) }]);
  } catch {
    return;
  }
}

import type { Metadata } from "next";
import { HostedPaymentReturn } from "@/components/payments/hosted-payment-return";

export const metadata: Metadata = {
  title: "Payment not completed",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function PaymentFailedPage() {
  return <HostedPaymentReturn outcome="failed" />;
}

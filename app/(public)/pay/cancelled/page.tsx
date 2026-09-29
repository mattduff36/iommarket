import type { Metadata } from "next";
import { HostedPaymentReturn } from "@/components/payments/hosted-payment-return";

export const metadata: Metadata = {
  title: "Checkout cancelled",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function PaymentCancelledPage() {
  return <HostedPaymentReturn outcome="cancelled" />;
}

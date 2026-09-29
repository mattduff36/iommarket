import type { Metadata } from "next";
import { HostedPaymentReturn } from "@/components/payments/hosted-payment-return";

export const metadata: Metadata = {
  title: "Payment confirmation",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function PaymentSuccessPage() {
  return <HostedPaymentReturn outcome="success" />;
}

import type { Metadata } from "next";
import { HostedPaymentReturn } from "@/components/payments/hosted-payment-return";
import { HostedPaymentConfirmation } from "@/components/payments/hosted-payment-confirmation";

export const metadata: Metadata = {
  title: "Payment confirmation",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PaymentSuccessPage({ searchParams }: {
  searchParams: Promise<{ paymentjobref?: string | string[] }>;
}) {
  const { paymentjobref } = await searchParams;
  const valid = typeof paymentjobref === "string" && /^\d{10,30}$/.test(paymentjobref);
  return <HostedPaymentReturn outcome="success">
    {valid ? <HostedPaymentConfirmation paymentJobRef={paymentjobref} /> : null}
  </HostedPaymentReturn>;
}

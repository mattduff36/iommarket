import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSampleCheckout } from "@/lib/payments/sample-checkout";
import { SampleCheckout } from "./checkout";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "FlowPay sample checkout",
  robots: { index: false, follow: false },
};

export default async function SampleCheckoutPage({
  params,
}: PageProps<"/sample-checkout/[id]">) {
  const { id } = await params;
  const checkout = await getSampleCheckout(id);
  if (!checkout) notFound();

  return <SampleCheckout checkout={checkout} />;
}

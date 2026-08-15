import type { Metadata } from "next";
import { PolicyDocumentPage } from "@/components/legal/policy-document-page";
import { getPolicyDefinition } from "@/lib/policies/registry";

const policy = getPolicyDefinition("refunds");

export const metadata: Metadata = {
  title: policy.title,
  description: "Refund rules for iTrader.im advertising services.",
};

export default function RefundsPage() {
  return <PolicyDocumentPage slug="refunds" />;
}

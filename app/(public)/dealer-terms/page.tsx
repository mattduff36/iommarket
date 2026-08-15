import type { Metadata } from "next";
import { PolicyDocumentPage } from "@/components/legal/policy-document-page";
import { getPolicyDefinition } from "@/lib/policies/registry";

const policy = getPolicyDefinition("dealer-terms");

export const metadata: Metadata = {
  title: policy.title,
  description: "Terms for motor dealers advertising vehicles on iTrader.im.",
};

export default function DealerTermsPage() {
  return <PolicyDocumentPage slug="dealer-terms" />;
}

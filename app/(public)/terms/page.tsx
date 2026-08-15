import type { Metadata } from "next";
import { PolicyDocumentPage } from "@/components/legal/policy-document-page";
import { getPolicyDefinition } from "@/lib/policies/registry";

const policy = getPolicyDefinition("terms");

export const metadata: Metadata = {
  title: policy.title,
  description: "Terms and conditions for using the iTrader.im marketplace.",
};

export default function TermsPage() {
  return <PolicyDocumentPage slug="terms" />;
}

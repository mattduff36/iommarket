import type { Metadata } from "next";
import { PolicyDocumentPage } from "@/components/legal/policy-document-page";
import { getPolicyDefinition } from "@/lib/policies/registry";

const policy = getPolicyDefinition("acceptable-use");

export const metadata: Metadata = {
  title: policy.title,
  description: "Acceptable use rules for the iTrader.im marketplace.",
};

export default function AcceptableUsePage() {
  return <PolicyDocumentPage slug="acceptable-use" />;
}

import type { Metadata } from "next";
import { PolicyDocumentPage } from "@/components/legal/policy-document-page";
import { getPolicyDefinition } from "@/lib/policies/registry";

const policy = getPolicyDefinition("privacy");

export const metadata: Metadata = {
  title: policy.title,
  description:
    "How iTrader.im collects, uses and protects personal data under Isle of Man law.",
};

export default function PrivacyPage() {
  return <PolicyDocumentPage slug="privacy" />;
}

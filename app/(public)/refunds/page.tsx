import type { Metadata } from "next";
import { PolicyDocumentPage } from "@/components/legal/policy-document-page";
import { getPolicyDefinition } from "@/lib/policies/registry";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";

const policy = getPolicyDefinition("refunds");

export const metadata: Metadata = {
  title: policy.title,
  description: "Refund rules for iTrader.im advertising services.",
  alternates: { canonical: buildCanonicalUrl(policy.route) },
};

export default function RefundsPage() {
  return <PolicyDocumentPage slug="refunds" />;
}

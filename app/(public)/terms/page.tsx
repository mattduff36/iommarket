import type { Metadata } from "next";
import { PolicyDocumentPage } from "@/components/legal/policy-document-page";
import { getPolicyDefinition } from "@/lib/policies/registry";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";

const policy = getPolicyDefinition("terms");

export const metadata: Metadata = {
  title: policy.title,
  description: "Terms and conditions for using the iTrader.im marketplace.",
  alternates: { canonical: buildCanonicalUrl(policy.route) },
};

export default function TermsPage() {
  return <PolicyDocumentPage slug="terms" />;
}

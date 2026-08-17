import type { Metadata } from "next";
import { PolicyDocumentPage } from "@/components/legal/policy-document-page";
import { getPolicyDefinition } from "@/lib/policies/registry";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";

const policy = getPolicyDefinition("private-seller-terms");

export const metadata: Metadata = {
  title: policy.title,
  description: "Terms for private sellers advertising vehicles on iTrader.im.",
  alternates: { canonical: buildCanonicalUrl(policy.route) },
};

export default function PrivateSellerTermsPage() {
  return <PolicyDocumentPage slug="private-seller-terms" />;
}

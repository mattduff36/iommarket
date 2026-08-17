import type { Metadata } from "next";
import { PolicyDocumentPage } from "@/components/legal/policy-document-page";
import { getPolicyDefinition } from "@/lib/policies/registry";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";

const policy = getPolicyDefinition("cookies");

export const metadata: Metadata = {
  title: policy.title,
  description: "How iTrader.im uses cookies and how you can manage preferences.",
  alternates: { canonical: buildCanonicalUrl(policy.route) },
};

export default function CookiesPage() {
  return <PolicyDocumentPage slug="cookies" />;
}

import type { Metadata } from "next";
import { PolicyDocumentPage } from "@/components/legal/policy-document-page";
import { getPolicyDefinition } from "@/lib/policies/registry";
import { publicPageMetadata } from "@/lib/seo/page-metadata";

const policy = getPolicyDefinition("terms");

export const metadata: Metadata = publicPageMetadata({
  title: policy.title,
  description: "Terms and conditions for using the iTrader.im marketplace.",
  path: policy.route,
});

export default function TermsPage() {
  return <PolicyDocumentPage slug="terms" />;
}

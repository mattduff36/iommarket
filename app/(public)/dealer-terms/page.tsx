import type { Metadata } from "next";
import { PolicyDocumentPage } from "@/components/legal/policy-document-page";
import { getPolicyDefinition } from "@/lib/policies/registry";
import { publicPageMetadata } from "@/lib/seo/page-metadata";

const policy = getPolicyDefinition("dealer-terms");

export const metadata: Metadata = publicPageMetadata({
  title: policy.title,
  description: "Terms for motor dealers advertising vehicles on iTrader.im.",
  path: policy.route,
});

export default function DealerTermsPage() {
  return <PolicyDocumentPage slug="dealer-terms" />;
}

import type { Metadata } from "next";
import { PolicyDocumentPage } from "@/components/legal/policy-document-page";
import { getPolicyDefinition } from "@/lib/policies/registry";
import { publicPageMetadata } from "@/lib/seo/page-metadata";

const policy = getPolicyDefinition("private-seller-terms");

export const metadata: Metadata = publicPageMetadata({
  title: policy.title,
  description: "Terms for private sellers advertising vehicles on iTrader.im.",
  path: policy.route,
});

export default function PrivateSellerTermsPage() {
  return <PolicyDocumentPage slug="private-seller-terms" />;
}

import type { Metadata } from "next";
import { PolicyDocumentPage } from "@/components/legal/policy-document-page";
import { getPolicyDefinition } from "@/lib/policies/registry";
import { publicPageMetadata } from "@/lib/seo/page-metadata";

const policy = getPolicyDefinition("refunds");

export const metadata: Metadata = publicPageMetadata({
  title: policy.title,
  description: "Refund rules for iTrader.im advertising services.",
  path: policy.route,
});

export default function RefundsPage() {
  return <PolicyDocumentPage slug="refunds" />;
}

import type { Metadata } from "next";
import { PolicyDocumentPage } from "@/components/legal/policy-document-page";
import { getPolicyDefinition } from "@/lib/policies/registry";
import { publicPageMetadata } from "@/lib/seo/page-metadata";

const policy = getPolicyDefinition("acceptable-use");

export const metadata: Metadata = publicPageMetadata({
  title: policy.title,
  description: "Acceptable use rules for the iTrader.im marketplace.",
  path: policy.route,
});

export default function AcceptableUsePage() {
  return <PolicyDocumentPage slug="acceptable-use" />;
}

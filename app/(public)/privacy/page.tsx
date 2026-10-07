import type { Metadata } from "next";
import { PolicyDocumentPage } from "@/components/legal/policy-document-page";
import { getPolicyDefinition } from "@/lib/policies/registry";
import { publicPageMetadata } from "@/lib/seo/page-metadata";

const policy = getPolicyDefinition("privacy");

export const metadata: Metadata = publicPageMetadata({
  title: policy.title,
  description:
    "How iTrader.im collects, uses and protects personal data under Isle of Man law.",
  path: policy.route,
});

export default function PrivacyPage() {
  return <PolicyDocumentPage slug="privacy" />;
}

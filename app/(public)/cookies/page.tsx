import type { Metadata } from "next";
import { PolicyDocumentPage } from "@/components/legal/policy-document-page";
import { getPolicyDefinition } from "@/lib/policies/registry";
import { publicPageMetadata } from "@/lib/seo/page-metadata";

const policy = getPolicyDefinition("cookies");

export const metadata: Metadata = publicPageMetadata({
  title: policy.title,
  description: "How iTrader.im uses cookies and how you can manage preferences.",
  path: policy.route,
});

export default function CookiesPage() {
  return <PolicyDocumentPage slug="cookies" />;
}

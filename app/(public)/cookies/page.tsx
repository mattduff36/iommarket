import type { Metadata } from "next";
import { PolicyDocumentPage } from "@/components/legal/policy-document-page";
import { getPolicyDefinition } from "@/lib/policies/registry";

const policy = getPolicyDefinition("cookies");

export const metadata: Metadata = {
  title: policy.title,
  description: "How iTrader.im uses cookies and how you can manage preferences.",
};

export default function CookiesPage() {
  return <PolicyDocumentPage slug="cookies" />;
}

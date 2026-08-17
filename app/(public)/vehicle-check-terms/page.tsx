import type { Metadata } from "next";
import { PolicyDocumentPage } from "@/components/legal/policy-document-page";
import { getPolicyDefinition } from "@/lib/policies/registry";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";

const policy = getPolicyDefinition("vehicle-check-terms");

export const metadata: Metadata = {
  title: policy.title,
  description:
    "The source, reliability, permitted-use, privacy, and liability terms for iTrader.im Vehicle Check.",
  alternates: { canonical: buildCanonicalUrl(policy.route) },
};

export default function VehicleCheckTermsPage() {
  return <PolicyDocumentPage slug="vehicle-check-terms" />;
}

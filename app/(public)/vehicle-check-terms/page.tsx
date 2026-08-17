import type { Metadata } from "next";
import { PolicyDocumentPage } from "@/components/legal/policy-document-page";
import { getPolicyDefinition } from "@/lib/policies/registry";

const policy = getPolicyDefinition("vehicle-check-terms");

export const metadata: Metadata = {
  title: policy.title,
  description:
    "The source, reliability, permitted-use, privacy, and liability terms for iTrader.im Vehicle Check.",
};

export default function VehicleCheckTermsPage() {
  return <PolicyDocumentPage slug="vehicle-check-terms" />;
}

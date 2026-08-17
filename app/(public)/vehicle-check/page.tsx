import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { VehicleCheckClient } from "@/components/vehicle-check/vehicle-check-client";
import { getPolicyDefinition } from "@/lib/policies/registry";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";

interface VehicleCheckPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export const metadata: Metadata = {
  title: "Vehicle Check",
  description:
    "Check UK and Isle of Man vehicle tax, MOT history, mileage, and auction references on itrader.im.",
  alternates: { canonical: buildCanonicalUrl("/vehicle-check") },
};

export default async function VehicleCheckPage({
  searchParams,
}: VehicleCheckPageProps) {
  const params = await searchParams;
  const initialRegistration = params.reg?.trim() || undefined;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <Breadcrumbs
        items={[{ label: "Vehicle Check", href: "/vehicle-check" }]}
      />
      <VehicleCheckClient
        initialRegistration={initialRegistration}
        policyVersion={getPolicyDefinition("vehicle-check-terms").version}
      />
    </div>
  );
}

import type { Metadata } from "next";
import { VehicleCheckClient } from "@/components/vehicle-check/vehicle-check-client";

interface VehicleCheckPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export const metadata: Metadata = {
  title: "Vehicle Check",
  description:
    "Check UK and Isle of Man vehicle tax, MOT history, mileage, and auction references on itrader.im.",
};

export default async function VehicleCheckPage({
  searchParams,
}: VehicleCheckPageProps) {
  const params = await searchParams;
  const initialRegistration = params.reg?.trim() || undefined;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <VehicleCheckClient initialRegistration={initialRegistration} />
    </div>
  );
}

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VehicleCheckResultPanel } from "@/components/vehicle-check/vehicle-check-result-panel";
import type { VehicleCheckResult } from "@/lib/services/vehicle-check-types";

function makeResult(): VehicleCheckResult {
  return {
    normalizedRegistration: "MC23PBX",
    displayRegistration: "MC23 PBX",
    isManx: false,
    lookupTargetRegistration: "MC23PBX",
    checkedAt: "2026-10-03T12:00:00.000Z",
    warnings: [],
    sourceNotes: [],
    motHistory: null,
    mileage: {
      latestMileage: 12000,
      latestMileageDate: "2026-09-01",
      earliestMileage: 9000,
      earliestMileageDate: "2025-09-01",
      averageAnnualMileage: 3000,
      points: [],
    },
    auctionHistory: null,
    vehicle: {
      registrationNumber: "MC23PBX",
      displayRegistrationNumber: "MC23 PBX",
      lookupPath: "uk",
      make: "Tesla",
      model: "Model Y RWD",
      colour: null,
      fuelType: null,
      taxStatus: "Taxed",
      taxDueDate: "2027-01-01",
      motStatus: "Valid",
      motExpiryDate: "2027-02-01",
      yearOfManufacture: null,
      engineSizeCc: null,
      co2Emissions: null,
      monthOfFirstRegistration: null,
      wheelPlan: null,
      euroStatus: null,
      category: null,
      previousUkRegistration: null,
      dateOfFirstRegistrationIom: null,
      roadTax12Month: null,
      roadTax6Month: null,
      firstUsedDate: null,
    },
  };
}

describe("VehicleCheckResultPanel status cards", () => {
  it("renders semantic traffic-light tones for all four metrics and neutral mileage", () => {
    const { container } = render(
      <VehicleCheckResultPanel
        result={makeResult()}
        policyVersion="test"
        onExportPdf={() => undefined}
      />,
    );

    const cardFor = (label: string) => screen.getByText(label).parentElement;
    expect(cardFor("Tax status")).toHaveClass("border-emerald-500/30", "bg-emerald-500/10");
    expect(cardFor("MOT status")).toHaveClass("border-emerald-500/30", "bg-emerald-500/10");
    expect(cardFor("Tax due")).toHaveClass("border-emerald-500/30", "bg-emerald-500/10");
    expect(cardFor("MOT due")).toHaveClass("border-emerald-500/30", "bg-emerald-500/10");

    const mileageHeadline = screen.getByText("Mileage headline").closest("div.rounded-xl");
    expect(mileageHeadline).toHaveClass("border-border", "bg-canvas/40");
    expect(container.querySelectorAll(".mt-6.grid.gap-3 > div")).toHaveLength(4);
  });
});

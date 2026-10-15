// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { VehicleCheckResultPanel } from "@/components/vehicle-check/vehicle-check-result-panel";
import type { VehicleCheckResult } from "@/lib/services/vehicle-check-types";

import { openVehicleCheckPrintWindow } from "@/components/vehicle-check/vehicle-check-print";

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


describe("Manx historical MOT presentation", () => {
  it("keeps both cards neutral and never calls an old UK expiry overdue", () => {
    const result = makeResult();
    result.isManx = true;
    result.vehicle!.lookupPath = "iom";
    result.vehicle!.previousUkRegistration = "GF61FWX";
    result.vehicle!.motExpiryDate = "2021-10-01";
    render(<VehicleCheckResultPanel result={result} policyVersion="test" onExportPdf={() => undefined} />);
    for (const label of ["UK MOT history only", "Last UK MOT expiry"]) {
      expect(screen.getByText(label).parentElement).toHaveClass("border-border", "bg-canvas/40");
    }
    expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
    expect(screen.queryByText("Valid")).not.toBeInTheDocument();
    expect(screen.getByText("Previous UK MOT history")).toBeInTheDocument();
    expect(screen.getByText("Historical UK date, not a current IOM due date")).toBeInTheDocument();
  });

  it("handles no linked UK history without implying a missing current MOT", () => {
    const result = makeResult(); result.isManx = true;
    result.vehicle!.motExpiryDate = null; result.vehicle!.motStatus = null;
    render(<VehicleCheckResultPanel result={result} policyVersion="test" onExportPdf={() => undefined} />);
    expect(screen.getAllByText("No UK history found")).toHaveLength(2);
    expect(screen.queryByText(/too new for its first MOT/)).not.toBeInTheDocument();
  });

  it.each([true, false])("exports the same MOT distinction for isManx=%s", (isManx) => {
    const result = makeResult(); result.isManx = isManx;
    result.vehicle!.motExpiryDate = "2021-10-01";
    const write = vi.fn();
    const open = vi.spyOn(window, "open").mockReturnValue({ document: { write, close: vi.fn() }, focus: vi.fn(), print: vi.fn(), setTimeout: vi.fn() } as unknown as Window);
    try {
      openVehicleCheckPrintWindow(result, "test");
      const html = write.mock.calls[0][0] as string;
      if (isManx) {
        expect(html).toContain("UK MOT history only");
        expect(html).toContain("Last UK MOT expiry");
        expect(html).not.toContain('<td class="error">1 Oct 2021');
        expect(html).not.toContain('>Valid</td>');
      } else {
        expect(html).toContain("MOT status");
        expect(html).toContain('<td class="error">1 Oct 2021');
      }
    } finally { open.mockRestore(); }
  });
});

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VehicleCheckClient } from "@/components/vehicle-check/vehicle-check-client";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

describe("VehicleCheckClient MD-VEH-003", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            normalizedRegistration: "AB12CDE",
            displayRegistration: "AB12 CDE",
            isManx: false,
            lookupTargetRegistration: "AB12CDE",
            vehicle: null,
            motHistory: null,
            mileage: null,
            auctionHistory: null,
            warnings: [],
            sourceNotes: [],
            checkedAt: "2026-08-17T10:00:00.000Z",
          },
        }),
      }),
    );
  });

  it("requires acknowledgement before the first lookup and stores only disclosure metadata", async () => {
    render(<VehicleCheckClient policyVersion="2026-08-17.1" />);

    const submit = screen.getByRole("button", { name: "Run live check" });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Registration number"), {
      target: { value: "AB12 CDE" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I acknowledge the Vehicle Check Terms/i,
      }),
    );
    fireEvent.click(submit);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const stored = window.localStorage.getItem(
      "itrader-vehicle-check-terms-acknowledgement",
    );
    expect(stored).toContain("2026-08-17.1");
    expect(stored).not.toMatch(/AB12|registration|result/i);
  });
});

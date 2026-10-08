// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdvancedSearchModal } from "@/components/marketplace/search/advanced-search-modal";
import { buildSearchUrl } from "@/lib/search/search-url";
import {
  FUEL_TYPE_FILTER_OPTIONS,
  FUEL_TYPE_OPTIONS,
} from "@/lib/constants/fuel-types";

describe("AdvancedSearchModal", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });

  it("offers the standardized fuel types in order", () => {
    render(
      <AdvancedSearchModal
        open
        onOpenChange={() => undefined}
        makes={[]}
        modelsByMake={{}}
        initial={{}}
        onApply={() => undefined}
      />
    );

    fireEvent.click(
      screen
        .getByText("Fuel Type")
        .parentElement!
        .querySelector("button")!
    );

    const options = screen.getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual([
      "Any",
      ...FUEL_TYPE_OPTIONS,
      FUEL_TYPE_FILTER_OPTIONS.at(-1)?.label,
    ]);
  });

  it("renders the requested vehicle search range boundaries", () => {
    render(
      <AdvancedSearchModal
        open
        onOpenChange={() => undefined}
        makes={[]}
        modelsByMake={{}}
        initial={{}}
        onApply={() => undefined}
      />
    );

    expect(screen.getByText("Price, Mileage & Year")).toBeTruthy();
    expect(screen.queryByText("Age")).toBeNull();
    expect(screen.getByText("£1,000 – £250,000")).toBeTruthy();
    expect(screen.getByText("0 mi – 200,000 mi")).toBeTruthy();
    expect(
      screen.getByText(`1920 – ${new Date().getFullYear()}`),
    ).toBeTruthy();
    expect(screen.getByText("0 mpg – 150 mpg")).toBeTruthy();
    expect(screen.getByText("£0 – £750")).toBeTruthy();
  });

  it("omits full-range defaults when applying filters", () => {
    const onApply = vi.fn();
    render(
      <AdvancedSearchModal
        open
        onOpenChange={() => undefined}
        makes={[]}
        modelsByMake={{}}
        initial={{}}
        onApply={onApply}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Apply Filters" }));

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        minPrice: undefined,
        maxPrice: undefined,
        minMileage: undefined,
        maxMileage: undefined,
        minYear: undefined,
        maxYear: undefined,
        minFuelConsumption: undefined,
        maxFuelConsumption: undefined,
        minTax: undefined,
        maxTax: undefined,
      }),
    );
  });

  it("round-trips canonical liters and hours through slider units", () => {
    const onApply = vi.fn();
    render(
      <AdvancedSearchModal
        open
        onOpenChange={() => undefined}
        makes={[]}
        modelsByMake={{}}
        initial={{
          minEngineSize: "1.6",
          maxEngineSize: "2.4",
          fuelType: "Electric",
          minChargingTime: "7.5",
          maxChargingTime: "10",
        }}
        onApply={onApply}
      />
    );

    expect(screen.getByRole("slider", { name: "Minimum Engine Size" }).getAttribute("aria-valuenow")).toBe("16");
    expect(screen.getByRole("slider", { name: "Maximum Engine Size" }).getAttribute("aria-valuenow")).toBe("24");
    expect(screen.getByRole("slider", { name: "Minimum Charging Time" }).getAttribute("aria-valuenow")).toBe("450");
    expect(screen.getByRole("slider", { name: "Maximum Charging Time" }).getAttribute("aria-valuenow")).toBe("600");

    fireEvent.click(screen.getByRole("button", { name: "Apply Filters" }));

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
      minEngineSize: "1.6",
      maxEngineSize: "2.4",
      minChargingTime: "7.5",
      maxChargingTime: "10",
    }));
    expect(buildSearchUrl({}, onApply.mock.calls[0]![0])).toBe(
      "/search?fuelType=Electric&minEngineSize=1.6&maxEngineSize=2.4&minChargingTime=7.5&maxChargingTime=10&numericFilterUnits=v1",
    );
  });

  it("round-trips ten-minute charging steps without floating-point drift", () => {
    const onApply = vi.fn();
    render(
      <AdvancedSearchModal
        open
        onOpenChange={() => undefined}
        makes={[]}
        modelsByMake={{}}
        initial={{
          fuelType: "Electric",
          minChargingTime: "0.166667",
          maxChargingTime: "1.666667",
          numericFilterUnits: "v1",
        }}
        onApply={onApply}
      />
    );

    expect(screen.getByRole("slider", { name: "Minimum Charging Time" }).getAttribute("aria-valuenow")).toBe("10");
    expect(screen.getByRole("slider", { name: "Maximum Charging Time" }).getAttribute("aria-valuenow")).toBe("100");

    fireEvent.click(screen.getByRole("button", { name: "Apply Filters" }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
      minChargingTime: "0.166667",
      maxChargingTime: "1.666667",
      numericFilterUnits: "v1",
    }));
    expect(buildSearchUrl({}, onApply.mock.calls[0]![0])).toContain("minChargingTime=0.166667");
    expect(buildSearchUrl({}, onApply.mock.calls[0]![0])).toContain("maxChargingTime=1.666667");
    expect(buildSearchUrl({}, onApply.mock.calls[0]![0])).toContain("numericFilterUnits=v1");
  });
});

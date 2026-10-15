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

  it("keeps the existing car fields and omits van or motorhome controls", () => {
    render(
      <AdvancedSearchModal
        open
        onOpenChange={() => undefined}
        makes={[]}
        modelsByMake={{}}
        categories={[{ label: "Cars", value: "car" }]}
        initial={{ category: "car", bodyType: "Hatchback", doors: "5" }}
        onApply={() => undefined}
      />
    );

    expect(screen.getByText("Body Type")).toBeTruthy();
    expect(screen.getByText("Doors")).toBeTruthy();
    expect(screen.getByText("Boot Space")).toBeTruthy();
    expect(screen.queryByText("Wheelbase")).toBeNull();
    expect(screen.queryByText("Sleeping berths")).toBeNull();
  });

  it("shows catalog van fields and drops them when the category changes to cars", () => {
    const onApply = vi.fn();
    render(
      <AdvancedSearchModal
        open
        onOpenChange={() => undefined}
        makes={[]}
        modelsByMake={{}}
        categories={[
          { label: "Cars", value: "car" },
          { label: "Vans", value: "van-id" },
        ]}
        initial={{
          category: "van-id",
          bodyType: "Panel van",
          wheelbase: "Long",
          roofHeight: "High",
          minPayload: "1000",
        }}
        onApply={onApply}
      />
    );

    expect(screen.getByText("Wheelbase")).toBeTruthy();
    expect(screen.getByText("Roof height")).toBeTruthy();
    expect(screen.getByText("Payload (kg)")).toBeTruthy();
    expect(screen.getByText("Load space length (m)")).toBeTruthy();
    expect(screen.getByText("Gross vehicle weight (kg)")).toBeTruthy();
    expect(screen.queryByText("Hatchback")).toBeNull();

    fireEvent.click(screen.getByText("Category").parentElement!.querySelector("button")!);
    fireEvent.click(screen.getByRole("option", { name: "Cars" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply Filters" }));

    const applied = onApply.mock.calls[0]![0];
    expect(applied.category).toBe("car");
    expect(applied.wheelbase).toBeUndefined();
    expect(applied.roofHeight).toBeUndefined();
    expect(applied.minPayload).toBeUndefined();
    expect(applied.bodyType).toBeUndefined();
    expect(buildSearchUrl({}, applied)).not.toContain("wheelbase");
  });

  it("omits car body, doors, and boot fields for motorbikes and keeps gearbox", () => {
    render(
      <AdvancedSearchModal
        open
        onOpenChange={() => undefined}
        makes={[]}
        modelsByMake={{}}
        initial={{ category: "motorbike", bodyType: "Hatchback", doors: "2" }}
        onApply={() => undefined}
      />
    );

    expect(screen.queryByText("Body Type")).toBeNull();
    expect(screen.queryByText("Doors")).toBeNull();
    expect(screen.queryByText("Boot Space")).toBeNull();
    expect(screen.getByText("Gearbox")).toBeTruthy();
    expect(screen.getByText("Fuel Type")).toBeTruthy();
    expect(screen.getByText("Market")).toBeTruthy();
  });

  it("shows motorhome catalog fields and applies their search keys", () => {
    const onApply = vi.fn();
    render(
      <AdvancedSearchModal
        open
        onOpenChange={() => undefined}
        makes={[]}
        modelsByMake={{}}
        initial={{
          category: "motorhome",
          sleepingLayout: "Island bed",
          mainLayout: "Rear lounge",
          minBerths: "2",
          maxBerths: "4",
          minMtplm: "3000",
          minOverallLength: "6",
        }}
        onApply={onApply}
      />
    );

    expect(screen.getByText("Motorhome type")).toBeTruthy();
    expect(screen.getByText("Sleeping berths")).toBeTruthy();
    expect(screen.getByText("Belted travelling seats")).toBeTruthy();
    expect(screen.getByText("Sleeping layout")).toBeTruthy();
    expect(screen.getByText("Main layout")).toBeTruthy();
    expect(screen.getByText("Overall length (m)")).toBeTruthy();
    expect(screen.getByText("Maximum laden weight MTPLM/MAM (kg)")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Apply Filters" }));
    expect(buildSearchUrl({}, onApply.mock.calls[0]![0])).toBe(
      "/search?category=motorhome&minBerths=2&maxBerths=4&sleepingLayout=Island+bed&mainLayout=Rear+lounge&minOverallLength=6&minMtplm=3000",
    );
  });
});

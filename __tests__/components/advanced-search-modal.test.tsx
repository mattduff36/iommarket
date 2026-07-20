import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdvancedSearchModal } from "@/components/marketplace/search/advanced-search-modal";
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
});

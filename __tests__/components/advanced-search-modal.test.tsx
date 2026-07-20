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
});

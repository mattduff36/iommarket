// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HeroSearch } from "@/components/marketplace/hero-search";
import styles from "@/components/marketplace/hero-search.module.css";
import {
  HomeCategoryProvider,
  useHomeCategory,
} from "@/components/marketplace/home/home-category-context";
import type { SearchParams } from "@/lib/search/search-url";

const push = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/components/marketplace/search/advanced-search-modal", () => ({
  AdvancedSearchModal: ({
    open,
    initial,
    onApply,
  }: {
    open: boolean;
    initial: SearchParams;
    onApply: (values: SearchParams) => void;
  }) =>
    open ? (
      <div data-testid="advanced-modal">
        <p data-testid="modal-category">{initial.category ?? ""}</p>
        <p data-testid="modal-make">{initial.make ?? ""}</p>
        <p data-testid="modal-model">{initial.model ?? ""}</p>
        <p data-testid="modal-region">{initial.region ?? ""}</p>
        <p data-testid="modal-min-price">{initial.minPrice ?? ""}</p>
        <p data-testid="modal-wheelbase">{initial.wheelbase ?? ""}</p>
        <button
          type="button"
          onClick={() =>
            onApply({
              category: "van",
              make: "BMW",
              model: "320",
              region: "douglas",
              minPrice: "5000",
              wheelbase: "L2",
            })
          }
        >
          Apply mock advanced
        </button>
      </div>
    ) : null,
}));

function SharedCategory() {
  const value = useHomeCategory();
  return <p data-testid="shared-category">{value?.category}</p>;
}

function renderHero() {
  return render(
    <HomeCategoryProvider>
      <HeroSearch
        inventoryByCategory={{
          car: {
            makes: [{ label: "BMW", value: "BMW", count: 2 }],
            modelsByMake: { BMW: ["320"] },
            modelCountsByMake: { BMW: { "320": 2 } },
          },
          van: {
            makes: [{ label: "Ford", value: "Ford", count: 1 }],
            modelsByMake: { Ford: ["Transit"] },
            modelCountsByMake: { Ford: { Transit: 1 } },
          },
        }}
        categories={[
          { label: "Cars", value: "car" },
          { label: "Vans", value: "van" },
          { label: "Motorbikes", value: "motorbike" },
          { label: "Motorhomes", value: "motorhome" },
        ]}
        regions={[{ label: "Douglas", value: "douglas" }]}
      />
      <SharedCategory />
    </HomeCategoryProvider>,
  );
}

describe("homepage category search", () => {
  beforeEach(() => {
    push.mockReset();
  });

  it("defaults to Cars and submits that category", async () => {
    const user = userEvent.setup();
    renderHero();

    expect(screen.getByRole("tab", { name: "Cars" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("shared-category")).toHaveTextContent("car");
    expect(screen.getByRole("tablist", { name: "Vehicle category" }).querySelector("svg")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(push).toHaveBeenCalledWith("/search?category=car");
  });

  it("keeps the tab category through modal apply, category switches, and reset", async () => {
    const user = userEvent.setup();
    renderHero();

    await user.click(screen.getByRole("button", { name: "Advanced Search" }));
    expect(screen.getByTestId("modal-category")).toHaveTextContent("car");

    await user.click(screen.getByRole("button", { name: "Apply mock advanced" }));

    expect(screen.getByRole("tab", { name: "Cars" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("modal-category")).toHaveTextContent("car");
    expect(screen.getByTestId("modal-make")).toHaveTextContent("BMW");
    expect(screen.getByTestId("modal-model")).toHaveTextContent("320");
    expect(screen.getByTestId("modal-region")).toHaveTextContent("douglas");
    expect(screen.getByTestId("modal-min-price")).toHaveTextContent("5000");
    expect(screen.getByTestId("modal-wheelbase")).toHaveTextContent("");

    await user.click(screen.getByRole("tab", { name: "Vans" }));

    expect(screen.getByRole("tab", { name: "Vans" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("shared-category")).toHaveTextContent("van");
    expect(screen.getByTestId("modal-category")).toHaveTextContent("van");
    expect(screen.getByTestId("modal-make")).toHaveTextContent("");
    expect(screen.getByTestId("modal-model")).toHaveTextContent("");
    expect(screen.getByTestId("modal-wheelbase")).toHaveTextContent("");
    expect(screen.getByTestId("modal-region")).toHaveTextContent("douglas");
    expect(screen.getByTestId("modal-min-price")).toHaveTextContent("5000");

    await user.click(screen.getByRole("button", { name: "Reset filters" }));

    expect(screen.getByRole("tab", { name: "Vans" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("modal-category")).toHaveTextContent("van");
    expect(screen.getByTestId("modal-region")).toHaveTextContent("");
    expect(screen.getByTestId("modal-min-price")).toHaveTextContent("");
    expect(push).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(push).toHaveBeenCalledWith("/search?category=van");
  });

  it("styles connected category tabs with the existing palette and heading font", () => {
    renderHero();
    const css = readFileSync("components/marketplace/hero-search.module.css", "utf8");
    const cars = screen.getByRole("tab", { name: "Cars" });
    const vans = screen.getByRole("tab", { name: "Vans" });

    expect(cars.className).toContain(styles.tab);
    expect(cars.className).toContain(styles.active);
    expect(cars.className).toContain(styles.car);
    expect(vans.className).toContain(styles.tab);
    expect(vans.className).not.toContain(styles.active);
    expect(css).toContain("height: 41px");
    expect(css).toContain("var(--font-heading)");
    expect(css).toContain("var(--color-white)");
    expect(css).toContain("var(--color-neon-red-500)");
    expect(css).toContain("var(--color-neon-blue-500)");
    expect(css).toContain("var(--color-premium-gold-500)");
    expect(css).toContain("var(--color-metallic-500)");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).not.toMatch(/svg|icon/i);
  });
});

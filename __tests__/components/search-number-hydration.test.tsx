// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ListingCard } from "@/components/marketplace/listing-card";
import { SearchControls } from "@/components/marketplace/search/search-controls";

vi.mock("@/actions/user-tools", () => ({ toggleFavourite: vi.fn() }));
vi.mock("@/components/navigation/navigation-pending", () => ({
  useNavigationRouter: () => ({ push: vi.fn() }),
}));

it("hydrates listing prices and expanded search ranges across default number locales", async () => {
  const originalFormat = Number.prototype.toLocaleString;
  let defaultLocale = "en-GB";
  const format = vi.spyOn(Number.prototype, "toLocaleString").mockImplementation(
    function (this: number, locale, options) {
      return originalFormat.call(this, locale ?? defaultLocale, options);
    },
  );
  const search = (
    <>
      <ListingCard title="Hatchback" price={1000} />
      <ListingCard title="Van" price={12500.5} />
      <SearchControls
        makes={[]}
        modelsByMake={{}}
        mode="submit"
        initial={{ maxPrice: "25000", maxMileage: "45000" }}
      />
    </>
  );
  const container = document.createElement("div");
  document.body.append(container);
  const onRecoverableError = vi.fn();
  let root: Root | undefined;

  try {
    container.innerHTML = renderToString(search);
    defaultLocale = "de-DE";
    await act(async () => {
      root = hydrateRoot(container, search, { onRecoverableError });
    });

    expect(onRecoverableError).not.toHaveBeenCalled();
    for (const value of ["£1,000", "£12,500.50", "£25,000", "45,000 mi"]) {
      expect(container.textContent).toContain(value);
    }
  } finally {
    if (root) await act(async () => root?.unmount());
    container.remove();
    format.mockRestore();
  }
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  CreateListingAttributeFields,
  type ListingAttributeDef,
} from "@/app/(public)/sell/create-listing-attribute-fields";
import { getAttributeFieldConfig } from "@/lib/listings/attribute-ui";
import { attributeDefsForCategory } from "@/prisma/seed/catalog-attributes";

afterEach(() => cleanup());

function field(slug: string, retainedValue?: string) {
  const seed = attributeDefsForCategory("motorhome").find((attribute) => attribute.slug === slug);
  if (!seed) throw new Error(slug);
  const attr: ListingAttributeDef = { id: `mh_${slug}`, ...seed };
  const config = getAttributeFieldConfig("motorhome", attr, undefined, { retainedValue });
  if (!config) throw new Error(`hidden ${slug}`);
  return { attr, config };
}

describe("CreateListingAttributeFields", () => {
  it("shows essentials before collapsible additional details and keeps a legacy body type", () => {
    render(
      <CreateListingAttributeFields
        categorySlug="motorhome"
        visibleAttributes={[field("make"), field("body-type", "Hatchback"), field("sleeping-berths")]}
        attributeValues={{ "mh_body-type": "Hatchback", "mh_sleeping-berths": "4" }}
        isDetailsStep
        getFieldError={() => undefined}
        onAttributeChange={() => undefined}
      />,
    );

    const make = screen.getByLabelText(/Make/);
    const body = screen.getByLabelText(/Motorhome type/);
    const berths = screen.getByLabelText(/Sleeping berths/);
    expect(make.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(body.compareDocumentPosition(screen.getByText("Additional details")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Habitation")).toBeTruthy();
    expect((body as HTMLSelectElement).className).toContain("text-base");
    expect(screen.getByRole("option", { name: "Hatchback" })).toBeTruthy();
    expect((berths as HTMLInputElement).className).toContain("text-base");
  });

  it("lets the seller collapse and reopen a populated or invalid additional group", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <CreateListingAttributeFields
        categorySlug="motorhome"
        visibleAttributes={[field("make"), field("sleeping-berths")]}
        attributeValues={{ "mh_sleeping-berths": "4" }}
        isDetailsStep
        getFieldError={() => undefined}
        onAttributeChange={() => undefined}
      />,
    );

    const summary = screen.getByText("Habitation");
    const details = summary.closest("details");
    expect(details).toHaveProperty("open", true);
    await user.click(summary);
    expect(details).toHaveProperty("open", false);
    await user.click(summary);
    expect(details).toHaveProperty("open", true);

    rerender(
      <CreateListingAttributeFields
        categorySlug="motorhome"
        visibleAttributes={[field("make"), field("sleeping-berths")]}
        attributeValues={{ "mh_sleeping-berths": "4" }}
        isDetailsStep
        getFieldError={(name) => (name === "attr-mh_sleeping-berths" ? "Enter a whole number." : undefined)}
        onAttributeChange={() => undefined}
      />,
    );
    await user.click(summary);
    expect(details).toHaveProperty("open", false);
    await user.click(summary);
    expect(details).toHaveProperty("open", true);
  });
});

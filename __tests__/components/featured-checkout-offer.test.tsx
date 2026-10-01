// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FeaturedCheckoutOffer } from "@/app/(public)/sell/create-listing-featured-offer";

describe("FeaturedCheckoutOffer", () => {
  it("defaults off and updates the paid total when Featured is selected", () => {
    const onChange = vi.fn();
    render(
      <FeaturedCheckoutOffer
        listingFeePence={499}
        featuredUpgradePricePence={500}
        listingFeeDue
        includeFeatured={false}
        onIncludeFeaturedChange={onChange}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: "Add Featured to this checkout" });
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText(/Listing fee £4\.99/)).toBeInTheDocument();
    expect(screen.getByText(/Featured £5\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Total/).textContent).toMatch(/£4\.99/);
    expect(screen.getByText(/starts after the listing is approved/)).toBeInTheDocument();

    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("explains that a declined Featured payment leaves a free listing submitted", () => {
    render(
      <FeaturedCheckoutOffer
        listingFeePence={499}
        featuredUpgradePricePence={500}
        listingFeeDue={false}
        includeFeatured
        onIncludeFeaturedChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/No listing fee is due/)).toBeInTheDocument();
    expect(screen.getByText(/If that Featured payment is declined, the standard listing stays submitted/)).toBeInTheDocument();
    expect(screen.getByText(/Featured total/).textContent).toMatch(/£5\.00/);
    expect(screen.queryByText(/£9\.99/)).not.toBeInTheDocument();
  });

  it("does not offer another Featured purchase", () => {
    render(
      <FeaturedCheckoutOffer
        listingFeePence={499}
        featuredUpgradePricePence={500}
        listingFeeDue
        includeFeatured={false}
        alreadyPurchased
        onIncludeFeaturedChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/does not buy it again/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText(/Listing fee £4\.99\. Total £4\.99/)).toBeInTheDocument();
  });
});

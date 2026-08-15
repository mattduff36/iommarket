import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ListingCard } from "@/components/marketplace/listing-card";

const toggleFavouriteMock = vi.fn();

vi.mock("@/actions/user-tools", () => ({
  toggleFavourite: (...args: unknown[]) => toggleFavouriteMock(...args),
}));

vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    priority: _priority,
    sizes: _sizes,
    unoptimized: _unoptimized,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & {
    fill?: boolean;
    priority?: boolean;
    sizes?: string;
    unoptimized?: boolean;
  }) => <img {...props} />,
}));

const listing = {
  title: "Island Hatchback",
  price: 12500,
  href: "/listings/listing-1",
  listingId: "listing-1",
};

describe("ListingCard", () => {
  it("exposes one primary overlay link covering the card", () => {
    const { container } = render(
      <ListingCard
        title={listing.title}
        price={listing.price}
        href={listing.href}
        listingId={listing.listingId}
      />,
    );

    const primaryLink = screen.getByRole("link", { name: listing.title });
    expect(primaryLink).toHaveAttribute("href", listing.href);
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(primaryLink.querySelector("a, button")).toBeNull();
  });

  it("does not render a link when the card has no destination", () => {
    render(<ListingCard title={listing.title} price={listing.price} />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("article", { name: listing.title })).toBeTruthy();
  });

  it("keeps the favourite control outside the primary link", async () => {
    toggleFavouriteMock.mockResolvedValue({ data: { isFavourite: true } });

    render(
      <ListingCard
        title={listing.title}
        price={listing.price}
        href={listing.href}
        listingId={listing.listingId}
        showFavourite
      />,
    );

    const primaryLink = screen.getByRole("link", { name: listing.title });
    const favourite = screen.getByRole("button", { name: /save to favourites/i });

    expect(primaryLink.contains(favourite)).toBe(false);
    expect(primaryLink.querySelector("button")).toBeNull();

    fireEvent.click(favourite);

    await waitFor(() => {
      expect(toggleFavouriteMock).toHaveBeenCalledWith({ listingId: listing.listingId });
    });
  });

  it("makes the overlay link keyboard-focusable", () => {
    render(
      <ListingCard
        title={listing.title}
        price={listing.price}
        href={listing.href}
      />,
    );

    const primaryLink = screen.getByRole("link", { name: listing.title });
    primaryLink.focus();
    expect(primaryLink).toHaveFocus();
    expect(primaryLink.className).toContain("ring-inset");
  });

  it("shows a prominent Category N/S write-off badge POL-LIST-001", () => {
    render(
      <ListingCard
        title={listing.title}
        price={listing.price}
        href={listing.href}
        writeOffCategory="Category N"
      />,
    );

    expect(screen.getByText("Category N write-off")).toBeTruthy();
  });
});

import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DealerDirectory } from "@/components/dealers/dealer-directory";
import { DealerSpotlights } from "@/components/dealers/dealer-spotlights";

vi.mock("@/components/dealers/dealer-logo", () => ({
  DealerLogo: ({ dealerName }: { dealerName: string }) => (
    <span data-testid="dealer-logo">{dealerName}</span>
  ),
}));

const dealers = [
  {
    id: "dealer-one",
    name: "Alpha Autos",
    slug: "alpha-autos",
    bio: "Island dealer",
    logoUrl: null,
    _count: { listings: 2 },
  },
  {
    id: "dealer-two",
    name: "Beta Motors",
    slug: "beta-motors",
    bio: null,
    logoUrl: "https://example.com/logo.png",
    _count: { listings: 0 },
  },
];

describe("DealerSpotlights", () => {
  it("links to the dedicated directory and renders every dealer once", () => {
    render(<DealerSpotlights dealers={dealers} />);

    expect(screen.getByRole("link", { name: "View all dealers" })).toHaveAttribute(
      "href",
      "/dealers",
    );
    expect(screen.getAllByRole("article")).toHaveLength(dealers.length);
    expect(screen.getAllByRole("link", { name: /Visit .* profile/ })).toHaveLength(
      dealers.length,
    );
    expect(screen.getByRole("region", { name: "Dealer spotlights" })).toBeTruthy();
  });
});

describe("DealerDirectory", () => {
  it("renders every eligible dealer with reachable profile links", () => {
    render(<DealerDirectory dealers={dealers} />);

    expect(screen.getAllByRole("article")).toHaveLength(dealers.length);
    expect(screen.getByRole("link", { name: "Visit Alpha Autos profile" })).toHaveAttribute(
      "href",
      "/dealers/alpha-autos",
    );
    expect(screen.getByRole("link", { name: "Visit Beta Motors profile" })).toHaveAttribute(
      "href",
      "/dealers/beta-motors",
    );
  });

  it("shows a polished empty state", () => {
    render(<DealerDirectory dealers={[]} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "No dealers are currently listed",
    );
  });
});

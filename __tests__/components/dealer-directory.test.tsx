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
    verified: true,
    _count: { listings: 2 },
  },
  {
    id: "dealer-two",
    name: "Beta Motors",
    slug: "beta-motors",
    bio: null,
    logoUrl: "https://example.com/logo.png",
    verified: false,
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
    const profileLinks = screen.getAllByRole("link", { name: /Visit .* profile/ });
    expect(profileLinks).toHaveLength(dealers.length);
    for (const link of profileLinks) {
      expect(link.querySelector("a, button")).toBeNull();
    }
    expect(screen.getByRole("region", { name: "Dealer spotlights" })).toBeTruthy();
  });
});

describe("DealerDirectory", () => {
  it("renders every eligible dealer with reachable profile links", () => {
    render(<DealerDirectory dealers={dealers} />);

    const alpha = screen.getByRole("link", { name: "Visit Alpha Autos profile" });
    const beta = screen.getByRole("link", { name: "Visit Beta Motors profile" });
    expect(alpha).toHaveAttribute("href", "/dealers/alpha-autos");
    expect(beta).toHaveAttribute("href", "/dealers/beta-motors");
    expect(alpha.className).toContain("absolute");
    expect(alpha.className).toContain("inset-0");
    expect(alpha.querySelector("a, button")).toBeNull();
    expect(beta.querySelector("a, button")).toBeNull();
    expect(screen.getAllByRole("link", { name: /Visit .* profile/ })).toHaveLength(
      dealers.length,
    );
    for (const card of screen.getAllByRole("article")) {
      expect(card.querySelectorAll("a")).toHaveLength(1);
      expect(card.querySelector("button")).toBeNull();
    }
    expect(screen.getByText("Verified Dealer")).toBeInTheDocument();
    expect(screen.getAllByText("Verified Dealer")).toHaveLength(1);
  });

  it("shows a polished empty state", () => {
    render(<DealerDirectory dealers={[]} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "No dealers are currently listed",
    );
  });
});

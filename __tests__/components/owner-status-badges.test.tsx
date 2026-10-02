// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ListingOwnerStatusBadges } from "@/components/listings/owner-status-badges";

describe("ListingOwnerStatusBadges", () => {
  it("shows the lifecycle status without a Featured label", () => {
    render(<ListingOwnerStatusBadges status="LIVE" featured={false} />);

    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.queryByText(/Featured/)).not.toBeInTheDocument();
  });

  it("labels an active Featured listing separately from its lifecycle status", () => {
    render(<ListingOwnerStatusBadges status="PENDING" featured featuredPurchased />);

    expect(screen.getByText("Awaiting review")).toBeInTheDocument();
    expect(screen.getByText("Featured")).toBeInTheDocument();
    expect(screen.queryByText("Featured pending")).not.toBeInTheDocument();
  });

  it("labels a purchased placement that has not started yet", () => {
    render(
      <ListingOwnerStatusBadges status="TAKEN_DOWN" featured={false} featuredPurchased />,
    );

    expect(screen.getByText("Taken down")).toBeInTheDocument();
    expect(screen.getByText("Featured pending")).toBeInTheDocument();
  });
});

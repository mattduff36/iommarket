import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ListingDealerIdentity } from "@/components/dealers/listing-dealer-identity";

const { dealerFindFirstMock } = vi.hoisted(() => ({
  dealerFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    dealerProfile: {
      findFirst: dealerFindFirstMock,
    },
  },
}));

const {
  buildListingBreadcrumbItems,
  getPublicListingDealer,
} = await import("@/lib/dealers/public-listing-dealer");

describe("public listing dealer navigation", () => {
  it("omits dead dealer URLs when entitlement or account visibility fails", async () => {
    dealerFindFirstMock.mockResolvedValue(null);
    const now = new Date("2026-08-17T04:00:00.000Z");

    const publicDealer = await getPublicListingDealer("dealer-expired", now);
    const items = buildListingBreadcrumbItems({
      listingId: "listing-live",
      listingTitle: "Live vehicle",
      category: { name: "Cars", slug: "car" },
      publicDealer,
    });
    const { container } = render(
      <>
        <Breadcrumbs items={items} />
        <ListingDealerIdentity
          fallbackName="Expired Dealer"
          phone="01624 600000"
          publicDealer={publicDealer}
        />
      </>,
    );

    expect(dealerFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "dealer-expired",
        subscriptions: {
          some: {
            OR: expect.any(Array),
          },
        },
        user: {
          role: { in: ["DEALER", "ADMIN"] },
          disabledAt: null,
          deletedAt: null,
        },
      }),
      select: {
        name: true,
        slug: true,
        verified: true,
      },
    });
    expect(screen.getByText("Expired Dealer")).toBeVisible();
    expect(screen.getByText("01624 600000")).toBeVisible();
    expect(screen.queryByRole("link", { name: /Expired Dealer/ })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Cars" }),
    ).toHaveAttribute("href", "/search?category=car");
    expect(container.innerHTML).not.toContain("/dealers/expired");
    expect(container.innerHTML).not.toContain("dealer-expired");
  });
});

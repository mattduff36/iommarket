// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ favourites: vi.fn(), dealers: vi.fn() }));
vi.mock("@/lib/policy/gate", () => ({ requireAcceptedUser: async () => ({ id: "viewer" }) }));
vi.mock("@/lib/db", () => ({ db: { favourite: { findMany: mocks.favourites }, dealerProfile: { findMany: mocks.dealers } } }));
vi.mock("@/lib/listings/sample-visibility", () => ({ getSampleVisibility: async () => ({}), applySampleListingVisibility: (where: object) => where }));
vi.mock("@/lib/dealers/access", () => ({ getPublicDealerWhere: () => ({ user: { disabledAt: null } }) }));
vi.mock("@/lib/images/photo", () => ({ listingPhotoSelect: {}, toListingPhotoSource: () => null }));
vi.mock("@/components/marketplace/listing-card", () => ({ ListingCard: ({ title, href, badge }: { title: string; href?: string; badge?: string }) => <article><span>{title}</span><span>{badge}</span>{href ? <a href={href}>Open {title}</a> : null}</article> }));
import FavouritesPage from "@/app/(public)/account/favourites/page";

describe("saved listing entitlement visibility", () => {
  it("retains a saved listing as unavailable after dealer access ends, using one dealer query", async () => {
    const base = { status: "LIVE", expiresAt: new Date("2099-01-01"), price: 100, featured: false, images: [], region: { name: "Douglas" }, category: { name: "Cars" }, attributeValues: [] };
    mocks.favourites.mockResolvedValue([
      { id: "f1", listing: { ...base, id: "l1", title: "Revoked dealer car", dealerId: "revoked" } },
      { id: "f2", listing: { ...base, id: "l2", title: "Active dealer car", dealerId: "active" } },
      { id: "f3", listing: { ...base, id: "l3", title: "Private car", dealerId: null } },
    ]);
    mocks.dealers.mockResolvedValue([{ id: "active" }]);
    render(await FavouritesPage());
    expect(screen.getByText("Revoked dealer car").closest("article")).toHaveTextContent("Unavailable");
    expect(screen.queryByRole("link", { name: "Open Revoked dealer car" })).toBeNull();
    expect(screen.getByRole("link", { name: "Open Active dealer car" })).toHaveAttribute("href", "/listings/l2");
    expect(screen.getByRole("link", { name: "Open Private car" })).toHaveAttribute("href", "/listings/l3");
    expect(mocks.dealers).toHaveBeenCalledTimes(1);
    expect(mocks.favourites).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "viewer" }) }));
  });
});

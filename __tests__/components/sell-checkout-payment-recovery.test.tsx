// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listingFindUnique, paymentFindFirst } = vi.hoisted(() => ({
  listingFindUnique: vi.fn(),
  paymentFindFirst: vi.fn(),
}));
vi.mock("@/lib/policy/gate", () => ({
  requireAcceptedUser: vi.fn().mockResolvedValue({ id: "seller-1" }),
}));
vi.mock("@/lib/db", () => ({ db: {
  listing: { findUnique: listingFindUnique },
  payment: { findFirst: paymentFindFirst },
} }));
vi.mock("@/app/(public)/sell/checkout/retry-checkout-button", () => ({
  RetryCheckoutButton: () => <button>Open payment in new tab</button>,
}));
vi.mock("@/app/(public)/sell/checkout/checkout-status-actions", () => ({
  CheckoutStatusActions: () => <button>Refresh payment status</button>,
}));
import SellCheckoutPage from "@/app/(public)/sell/checkout/page";

describe("listing checkout payment recovery", () => {
  beforeEach(() => {
    listingFindUnique.mockResolvedValue({
      id: "listing-1", title: "Saved Vauxhall", userId: "seller-1",
      dealerId: null, status: "DRAFT",
    });
  });

  it("keeps another checkout hidden behind an unpaid declaration while review is needed", async () => {
    paymentFindFirst.mockResolvedValue({ status: "PENDING", createdAt: new Date(0) });
    render(await SellCheckoutPage({ searchParams: Promise.resolve({ listing: "listing-1", opened: "1" }) }));
    expect(screen.getByText("Payment not yet confirmed")).toBeInTheDocument();
    expect(screen.getByText(/if you have already paid, do not pay again/i)).toBeInTheDocument();
    expect(screen.getByText("I have not paid yet")).toBeInTheDocument();
    expect(screen.getByText("Open payment in new tab")).not.toBeVisible();
    expect(screen.getByRole("link", { name: "Continue editing draft" })).toBeInTheDocument();
  });

  it("does not offer another charge after a payment succeeds but moderation is still pending", async () => {
    paymentFindFirst.mockResolvedValue({ status: "SUCCEEDED", createdAt: new Date(0) });
    render(await SellCheckoutPage({ searchParams: Promise.resolve({ listing: "listing-1" }) }));
    expect(screen.getByText("Payment received")).toBeInTheDocument();
    expect(screen.queryByText("Open payment in new tab")).not.toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TradeListingActions } from "@/components/trade/status-actions";
import { TradeNav } from "@/components/trade/trade-nav";
import {
  listEligibleTradeSellers,
  sanitizeTradeBrowsePage,
  tradeBrowseHref,
  tradeMembershipLabel,
} from "@/lib/trade-exchange/listings";

const pathname = vi.hoisted(() => vi.fn(() => "/dealer/trade"));
const listingStatus = vi.hoisted(() => vi.fn());
const eligibleIds = vi.hoisted(() => vi.fn());
const dealerFindMany = vi.hoisted(() => vi.fn());
const rethrow = vi.hoisted(() =>
  vi.fn((error: unknown) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "digest" in error &&
      String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }
  }),
);

vi.mock("next/navigation", () => ({
  usePathname: () => pathname(),
  unstable_rethrow: (error: unknown) => rethrow(error),
}));

vi.mock("@/actions/trade/listings", () => ({
  tradeListingStatusAction: listingStatus,
}));

vi.mock("@/actions/trade/enquiries", () => ({
  tradeEnquiryStatusAction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { dealerProfile: { findMany: dealerFindMany } },
}));

vi.mock("@/lib/trade-exchange/access", () => ({
  listEligibleTradeDealerIds: eligibleIds,
  sellerIsEligible: vi.fn(),
}));

describe("trade dealer usability", () => {
  beforeEach(() => {
    pathname.mockReturnValue("/dealer/trade");
    listingStatus.mockReset();
    rethrow.mockClear();
    eligibleIds.mockReset();
    dealerFindMany.mockReset();
  });

  it("marks the current trade section and keeps a dashboard exit", () => {
    pathname.mockReturnValue("/dealer/trade/stock");
    render(<TradeNav />);
    expect(screen.getByRole("link", { name: "My stock" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Browse" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dealer/dashboard");
    expect(screen.getByRole("navigation", { name: "Trade Exchange" })).toHaveClass("flex-wrap");
  });

  it("keeps browse pagination on real filter URLs and finite pages", () => {
    expect(sanitizeTradeBrowsePage("2")).toBe(2);
    expect(sanitizeTradeBrowsePage("0")).toBe(1);
    expect(sanitizeTradeBrowsePage("Infinity")).toBe(1);
    expect(sanitizeTradeBrowsePage(-4)).toBe(1);
    expect(sanitizeTradeBrowsePage(2.8)).toBe(2);
    expect(tradeBrowseHref({ make: "Ford", dealerId: "dealer-1", minYear: "" }, 3)).toBe(
      "/dealer/trade?make=Ford&dealerId=dealer-1&page=3",
    );
    expect(tradeMembershipLabel("PENDING")).toBe("In review");
  });

  it("offers only eligible sellers for the dealer filter", async () => {
    eligibleIds.mockResolvedValue(["dealer-ok"]);
    dealerFindMany.mockResolvedValue([{ id: "dealer-ok", name: "Ok Motors" }]);
    await expect(listEligibleTradeSellers()).resolves.toEqual([{ id: "dealer-ok", name: "Ok Motors" }]);
    expect(dealerFindMany).toHaveBeenCalledWith({
      where: { id: { in: ["dealer-ok"] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    eligibleIds.mockResolvedValue([]);
    await expect(listEligibleTradeSellers()).resolves.toEqual([]);
    expect(dealerFindMany).toHaveBeenCalledOnce();
  });

  it("reports a status error without a false success", async () => {
    listingStatus.mockResolvedValue({ error: "That listing could not be reserved.", ok: true });
    render(<TradeListingActions listingId="listing-1" actions={[{ status: "RESERVED", label: "Reserve" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Reserve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That listing could not be reserved.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("rethrows navigation from a status action before a generic error", async () => {
    const redirectError = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/dealer/trade;307",
    });
    listingStatus.mockRejectedValue(redirectError);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const caught: unknown[] = [];
    const onError = (event: ErrorEvent) => {
      caught.push(event.error);
      event.preventDefault();
    };
    const onRejection = (reason: unknown) => {
      caught.push(reason);
    };
    window.addEventListener("error", onError);
    process.on("unhandledRejection", onRejection);
    render(<TradeListingActions listingId="listing-1" actions={[{ status: "SOLD", label: "Mark sold" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark sold" }));
    await waitFor(() => expect(rethrow).toHaveBeenCalledWith(redirectError));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(caught).toContain(redirectError);
    window.removeEventListener("error", onError);
    process.off("unhandledRejection", onRejection);
    consoleError.mockRestore();
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  AdminDashboardStats,
  buildAdminDashboardStats,
} from "@/components/admin/admin-dashboard-stats";

afterEach(cleanup);

const SAMPLE_STATS = {
  totalUsers: 120,
  newUsers7d: 4,
  livePrivateListings: 7,
  liveDealerListings: 11,
  totalRevenue: 2500,
  recentPayments: 6,
  totalDealers: 9,
  verifiedDealers: 5,
};

describe("buildAdminDashboardStats", () => {
  it("builds exactly four informational stats without queue counts", () => {
    const stats = buildAdminDashboardStats(SAMPLE_STATS);
    const labels = stats.map((stat) => stat.label);

    expect(labels).toEqual([
      "Total Users",
      "Live Listings",
      "Revenue",
      "Dealers",
    ]);
    expect(labels).not.toContain("Open Reports");
    expect(labels.some((label) => /pending/i.test(label))).toBe(false);
  });
});

describe("AdminDashboardStats", () => {
  it("renders the four metrics inside one Marketplace overview card", () => {
    render(
      <AdminDashboardStats stats={buildAdminDashboardStats(SAMPLE_STATS)} />,
    );

    expect(screen.getByRole("heading", { name: "Marketplace overview" })).toBeTruthy();
    expect(screen.getByText("Total Users")).toBeTruthy();
    expect(screen.getByText("Live Listings")).toBeTruthy();
    expect(screen.getByText("Revenue")).toBeTruthy();
    expect(screen.getByText("Dealers")).toBeTruthy();
    expect(screen.getByText("+4 this week")).toBeTruthy();
    expect(screen.getByText("Private: 7 · Dealer: 11")).toBeTruthy();
    expect(screen.getByText("6 payments (30d)")).toBeTruthy();
    expect(screen.getByText("5 verified")).toBeTruthy();
    expect(screen.queryByText("Open Reports")).toBeNull();
    expect(screen.queryByText(/Pending/i)).toBeNull();
    expect(screen.queryByText("Views (7d)")).toBeNull();
    expect(screen.queryByText("Favourites")).toBeNull();
    expect(screen.queryByText("Regions")).toBeNull();
    expect(screen.queryByText("CMS Pages")).toBeNull();
  });

  it("renders compact boxed metrics without a duplicate heading or outer card", () => {
    const { container } = render(
      <AdminDashboardStats compact stats={buildAdminDashboardStats(SAMPLE_STATS)} />,
    );

    expect(screen.queryByRole("heading")).toBeNull();
    expect(container.querySelectorAll("dl")).toHaveLength(1);
    expect(container.querySelectorAll("dt")).toHaveLength(4);
    expect(container.querySelectorAll("dd")).toHaveLength(4);
    expect(container.querySelectorAll(".border")).toHaveLength(4);
    expect(screen.getByText("120")).toBeTruthy();
    expect(screen.getByText("18")).toBeTruthy();
    expect(screen.getByText(`\u00a3${SAMPLE_STATS.totalRevenue.toLocaleString()}`)).toBeTruthy();
    expect(screen.getByText("9")).toBeTruthy();
    expect(screen.getByText("+4 this week")).toBeTruthy();
    expect(screen.getByText("Private: 7 · Dealer: 11")).toBeTruthy();
    expect(screen.getByText("6 payments (30d)")).toBeTruthy();
    expect(screen.getByText("5 verified")).toBeTruthy();
  });

  it("uses a sterling icon and totals only the live private and dealer listings", () => {
    const stats = buildAdminDashboardStats({ ...SAMPLE_STATS, livePrivateListings: 0, liveDealerListings: 1234 });
    const { container } = render(<AdminDashboardStats compact stats={stats} />);
    expect(screen.getByText("1,234")).toBeTruthy();
    expect(screen.getByText("Private: 0 · Dealer: 1,234")).toBeTruthy();
    expect(container.querySelector("svg.lucide-pound-sterling")).not.toBeNull();
    expect(container.querySelector("svg.lucide-dollar-sign")).toBeNull();
  });
});

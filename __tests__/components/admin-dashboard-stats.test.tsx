import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AdminDashboardStats,
  buildAdminDashboardStats,
} from "@/components/admin/admin-dashboard-stats";

const SAMPLE_STATS = {
  totalUsers: 120,
  newUsers7d: 4,
  liveListings: 18,
  totalListings: 40,
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
    expect(screen.getByText("40 total")).toBeTruthy();
    expect(screen.getByText("6 payments (30d)")).toBeTruthy();
    expect(screen.getByText("5 verified")).toBeTruthy();
    expect(screen.queryByText("Open Reports")).toBeNull();
    expect(screen.queryByText(/Pending/i)).toBeNull();
    expect(screen.queryByText("Views (7d)")).toBeNull();
    expect(screen.queryByText("Favourites")).toBeNull();
    expect(screen.queryByText("Regions")).toBeNull();
    expect(screen.queryByText("CMS Pages")).toBeNull();
  });
});

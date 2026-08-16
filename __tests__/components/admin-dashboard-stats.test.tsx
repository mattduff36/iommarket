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
  views7d: 310,
  totalFavourites: 22,
  totalRegions: 8,
  contentPages: 3,
};

describe("buildAdminDashboardStats", () => {
  it("builds compact informational stats without queue counts", () => {
    const stats = buildAdminDashboardStats(SAMPLE_STATS);
    const labels = stats.map((stat) => stat.label);

    expect(labels).toEqual([
      "Total Users",
      "Live Listings",
      "Revenue",
      "Dealers",
      "Views (7d)",
      "Favourites",
      "Regions",
      "CMS Pages",
    ]);
    expect(labels).not.toContain("Open Reports");
    expect(labels.some((label) => /pending/i.test(label))).toBe(false);
  });
});

describe("AdminDashboardStats", () => {
  it("renders compact stat labels without Open Reports or Pending", () => {
    render(
      <AdminDashboardStats stats={buildAdminDashboardStats(SAMPLE_STATS)} />,
    );

    expect(screen.getByText("Total Users")).toBeTruthy();
    expect(screen.getByText("Live Listings")).toBeTruthy();
    expect(screen.queryByText("Open Reports")).toBeNull();
    expect(screen.queryByText(/Pending/i)).toBeNull();
  });
});

// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnalyticsRangeControl } from "@/components/admin/analytics/analytics-range-control";
import { CityRankList } from "@/components/admin/analytics/city-rank-list";
import { MetricSparkCard } from "@/components/admin/analytics/metric-spark-card";
import { RankBars } from "@/components/admin/analytics/rank-bars";
import { TrendChart } from "@/components/admin/analytics/trend-chart";
import { VisitorMapFrame } from "@/components/admin/analytics/visitor-map-frame";

const day = {
  date: "2026-03-28",
  label: "28 Mar",
  users: 0,
  pageviews: 0,
  listingViews: 0,
};

describe("admin analytics visuals", () => {
  it("shows the selected range, a trend legend, and the previous-period change", () => {
    render(<AnalyticsRangeControl current="30d" />);
    expect(screen.getByRole("link", { name: "30d" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "7d" })).not.toHaveAttribute("aria-current");

    render(
      <TrendChart
        includeVisitors
        points={[{ ...day, users: 4, pageviews: 8, listingViews: 2 }]}
      />,
    );
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("Pageviews")).toBeInTheDocument();
    expect(screen.getByText("Listing views")).toBeInTheDocument();

    render(
      <MetricSparkCard
        label="Listing views"
        value="15"
        current={15}
        previous={10}
        series={[2, 4, 9]}
        color="#C5A059"
      />,
    );
    expect(screen.getByText("Up 50% vs previous period")).toBeInTheDocument();
  });

  it("keeps empty, unplotted, and loading states explicit", () => {
    render(<TrendChart includeVisitors={false} points={[day]} />);
    expect(screen.getByText("No daily activity in this range yet.")).toBeInTheDocument();

    render(<RankBars items={[]} emptyLabel="No device breakdown in this range." />);
    expect(screen.getByText("No device breakdown in this range.")).toBeInTheDocument();

    render(
      <CityRankList cities={[{ city: "Douglas", country: "Isle of Man", count: 3, mapped: false }]} />,
    );
    expect(screen.getByText("Douglas")).toBeInTheDocument();
    expect(screen.getByText("Isle of Man · not plotted")).toBeInTheDocument();

    render(<VisitorMapFrame state="loading" />);
    expect(screen.getByText("Loading visitor map")).toBeInTheDocument();
    const mapRegion = screen.getByRole("region", { name: "Visitor locations" });
    expect(mapRegion.className).toContain("min-h-80");
    expect(mapRegion.className).toContain("flex-1");
    expect(mapRegion.querySelector("style")?.textContent).toContain("maplibregl-ctrl-group");
    expect(mapRegion.querySelector("style")?.textContent).toContain("maplibregl-ctrl-attrib-inner");
  });
});

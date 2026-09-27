import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  CostUsageChart,
  costChartDomain,
  netCostValues,
} from "@/app/(admin)/admin/costs/cost-usage-chart";
import { CostUsagePanel } from "@/app/(admin)/admin/costs/cost-usage-panel";
import type { CostUsageDayPoint } from "@/lib/costs/usage-view";

const seriesKeys = ["Development (Cursor)", "Manual Adjustment"];
const points: CostUsageDayPoint[] = [
  {
    day: "2026-09-26",
    label: "26 Sep",
    daily: {
      "Development (Cursor)": 10_000,
      "Manual Adjustment": 0,
    },
    cumulative: {
      "Development (Cursor)": 10_000,
      "Manual Adjustment": 0,
    },
  },
  {
    day: "2026-09-27",
    label: "27 Sep",
    daily: {
      "Development (Cursor)": 2_000,
      "Manual Adjustment": -5_000,
    },
    cumulative: {
      "Development (Cursor)": 12_000,
      "Manual Adjustment": -5_000,
    },
  },
];

describe("cost usage chart", () => {
  it("uses a domain that extends below zero for cumulative credits", () => {
    expect(costChartDomain(points, seriesKeys)).toEqual({
      min: -5_000,
      max: 12_000,
    });
    expect(netCostValues(points, seriesKeys)).toEqual([10_000, 7_000]);
  });

  it("renders credits below zero and a declining net-total line", () => {
    const { container } = render(
      <CostUsageChart points={points} seriesKeys={seriesKeys} />,
    );

    expect(
      screen.getByRole("img", {
        name: /^Cumulative project costs by category/,
      }),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-chart-direction="negative"]'),
    ).not.toBeNull();

    const netPath = container.querySelector('[data-chart-line="net-total"]');
    const coordinates = netPath
      ?.getAttribute("d")
      ?.matchAll(/[ML] ([\d.]+) ([\d.]+)/g);
    const pointsOnLine = coordinates
      ? [...coordinates].map((match) => Number(match[2]))
      : [];

    expect(pointsOnLine).toHaveLength(2);
    expect(pointsOnLine[1]).toBeGreaterThan(pointsOnLine[0] ?? 0);
  });

  it("keeps a custom manual category visible in the filtered section list", () => {
    render(
      <CostUsagePanel
        isOwner
        sections={[
          {
            key: "manual:Manual Adjustment",
            label: "Manual Adjustment",
            amountLabel: "-£50.00",
            lines: [{
              id: "manual-credit",
              section: "Manual Adjustment",
              category: "OTHER",
              label: "Exclude costs page work",
              amountLabel: "-£50.00",
              amountMinor: -5_000,
              kind: "CHARGE",
              invoiceability: "INVOICEABLE",
              periodStart: "2026-09-27T00:00:00.000Z",
              periodEnd: "2026-09-28T00:00:00.000Z",
              provisional: false,
            }],
          },
        ]}
      />,
    );

    expect(screen.getAllByText("Manual Adjustment").length).toBeGreaterThan(1);
    expect(screen.getByText("Exclude costs page work")).not.toBeNull();
  });
});

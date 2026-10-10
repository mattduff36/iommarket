// @vitest-environment jsdom
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

  it("includes invoices and negative remaining, and breaks lines across nulls", () => {
    const billed: CostUsageDayPoint[] = [
      {
        day: "2026-10-04",
        label: "4 Oct",
        daily: { Hosting: 0 },
        cumulative: { Hosting: 35_000 },
        invoicedPence: 95_000,
        remainingToInvoicePence: -60_000,
      },
      {
        day: "2026-10-05",
        label: "5 Oct",
        daily: { Hosting: 0 },
        cumulative: { Hosting: null },
        invoicedPence: null,
        remainingToInvoicePence: null,
      },
      {
        day: "2026-10-06",
        label: "6 Oct",
        daily: { Hosting: 15_737 },
        cumulative: { Hosting: 50_737 },
        invoicedPence: 0,
        remainingToInvoicePence: -44_263,
      },
    ];
    expect(costChartDomain(billed, ["Hosting"])).toEqual({ min: -60_000, max: 95_000 });
    const { container } = render(
      <CostUsageChart points={billed} seriesKeys={["Hosting"]} billingApplied invoicesAvailable />,
    );
    const invoice = container.querySelector("[data-chart-line='invoiced']")?.getAttribute("d") ?? "";
    const net = container.querySelector("[data-chart-line='net-total']")?.getAttribute("d") ?? "";
    expect(invoice.match(/M/g)).toHaveLength(2);
    expect(net.match(/M/g)).toHaveLength(2);
    expect(invoice).not.toContain("L");
    expect(invoice).not.toContain("420.0");
    const coords = [...`${invoice} ${net}`.matchAll(/[ML] ([\d.-]+) ([\d.-]+)/g)]
      .map((match) => [Number(match[1]), Number(match[2])]);
    expect(coords.length).toBeGreaterThan(3);
    for (const [x, y] of coords) {
      expect(x).toBeGreaterThanOrEqual(56);
      expect(x).toBeLessThanOrEqual(784);
      expect(y).toBeGreaterThanOrEqual(16);
      expect(y).toBeLessThanOrEqual(228);
    }
    expect(container.querySelector("#cost-chart-description")?.textContent).toMatch(/4 Oct 2026 to 6 Oct 2026/);
    expect(container.querySelector("#cost-chart-description")?.textContent).toMatch(/£0\.00/);
    expect(container.querySelector("#cost-chart-description")?.textContent).toMatch(/-£442\.63/);
    expect(container.querySelectorAll("[data-chart-dot='invoiced']")).toHaveLength(2);
    expect(container.querySelectorAll("[data-chart-dot='net-total']")).toHaveLength(2);
  });

  it("draws dots only for known lines on a single day", () => {
    const { container } = render(
      <CostUsageChart
        billingApplied
        invoicesAvailable
        seriesKeys={[]}
        points={[{
          day: "2026-05-27",
          label: "27 May",
          daily: {},
          cumulative: {},
          invoicedPence: 50_000,
          remainingToInvoicePence: null,
        }]}
      />,
    );
    expect(container.querySelector("[data-chart-dot='invoiced']")).not.toBeNull();
    expect(container.querySelector("[data-chart-dot='net-total']")).toBeNull();
    expect(container.querySelector("[data-chart-line='net-total']")).toBeNull();
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

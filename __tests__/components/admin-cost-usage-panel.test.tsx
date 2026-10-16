// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CostUsagePanel } from "@/app/(admin)/admin/costs/cost-usage-panel";
import type { CostLineDto } from "@/lib/costs/dto";
import { toCostBillingDisplay, type CostBillingDisplay } from "@/lib/costs/usage-view";

function shiftDay(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = shiftDay(day, 1)) days.push(day);
  return days;
}

function costLine(id: string, day: string, amountMinor: number, category: CostLineDto["category"]): CostLineDto {
  return {
    id,
    section: category === "VERCEL_HOSTING" ? "Website hosting (Vercel)" : "Development (Cursor)",
    category,
    label: id,
    amountLabel: "",
    amountMinor,
    kind: "CHARGE",
    invoiceability: "PROVISIONAL",
    periodStart: `${day}T00:00:00.000Z`,
    periodEnd: `${shiftDay(day, 1)}T00:00:00.000Z`,
    provisional: true,
  };
}

function billing(): CostBillingDisplay {
  return toCostBillingDisplay({
    invoicedPence: 95_000,
    asOf: "2026-10-10T18:00:00.000Z",
    history: eachDay("2026-05-27", "2026-10-10").map((day) => {
      const invoicedPence = day >= "2026-10-04" ? 95_000 : day >= "2026-08-08" ? 70_000 : 50_000;
      let cost: number | null = null;
      if (day >= "2026-08-01") cost = 20_000;
      if (day >= "2026-09-10" && cost !== null) cost += 10_000;
      if (day >= "2026-10-01" && cost !== null) cost += 5_000;
      if (day >= "2026-10-06" && cost !== null) cost += 15_737;
      return {
        day,
        invoicedPence,
        remainingToInvoicePence: cost === null ? null : cost - invoicedPence,
      };
    }),
  });
}

function description(): string {
  return document.querySelector("#cost-chart-description")?.textContent ?? "";
}

describe("cost usage panel billing ranges", () => {
  it("switches preset ranges without dropping opening invoice or remaining balances", async () => {
    const user = userEvent.setup();
    render(
      <CostUsagePanel
        isOwner={false}
        billing={billing()}
        sections={[
          {
            key: "CURSOR",
            label: "Development (Cursor)",
            amountLabel: "",
            lines: [
              costLine("september-development", "2026-09-10", 10_000, "CURSOR"),
              costLine("october-open", "2026-10-01", 5_000, "CURSOR"),
              costLine("october-week", "2026-10-06", 15_737, "CURSOR"),
            ],
          },
          {
            key: "VERCEL_HOSTING",
            label: "Website hosting (Vercel)",
            amountLabel: "",
            lines: [costLine("august-hosting", "2026-08-01", 20_000, "VERCEL_HOSTING")],
          },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
    expect(description()).toMatch(/27 May 2026 to 10 Oct 2026/);
    expect(description()).toMatch(/£950\.00/);
    expect(description()).toMatch(/-£442\.63/);
    expect(screen.getByText("Invoiced")).not.toBeNull();
    expect(screen.getByText("Net total · remaining to invoice")).not.toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(/pricing|estimate notes|unpaid|refund/i)).toBeNull();

    await user.click(screen.getByRole("button", { name: "7d" }));
    expect(screen.getByRole("button", { name: "7d" }).getAttribute("aria-pressed")).toBe("true");
    expect(description()).toMatch(/4 Oct 2026 to 10 Oct 2026/);
    expect(description()).toMatch(/£950\.00/);
    expect(description()).toMatch(/-£442\.63/);
    expect(screen.getAllByText("£157.37").length).toBeGreaterThan(0);
    expect(screen.queryByText("august-hosting")).toBeNull();
    expect(screen.getAllByText("Website hosting (Vercel)").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Last month" }));
    expect(description()).toMatch(/1 Sept 2026 to 30 Sept 2026/);
    expect(description()).toMatch(/£700\.00/);
    expect(description()).not.toMatch(/£950\.00/);

    await user.click(screen.getByRole("button", { name: "MTD" }));
    expect(description()).toMatch(/1 Oct 2026 to 10 Oct 2026/);
    expect(description()).toMatch(/£950\.00/);
    expect(screen.getByRole("heading", { name: "What the costs are made of" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Largest cost days" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Costs by charged day" })).not.toBeNull();
  });
});

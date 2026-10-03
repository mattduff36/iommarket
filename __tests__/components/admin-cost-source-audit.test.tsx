// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CostSourceAudit } from "@/app/(admin)/admin/costs/cost-source-audit";
import type { CursorAuditDto } from "@/lib/costs/dto";

describe("source audit presentation", () => {
  it("retains unavailable coverage instead of presenting zero cash", () => {
    render(<CostSourceAudit audit={{ status: "unavailable", reason: "Only aggregate client charges were supplied.", currency: "USD", rows: [] }} />);
    expect(screen.getByText("Only aggregate client charges were supplied.")).toBeTruthy();
    expect(screen.queryByText(/\$0/)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("separates included estimates from provider charges and paginates model rows", async () => {
    const rows: CursorAuditDto['rows'] = Array.from({ length: 16 }, (_, i) => ({
      day: "2026-10-01", model: `Model ${i}`, funding: i === 0 ? "on-demand" : "included", eventCount: 1,
      nominalUsd: "2", nominalBasis: "provider-reported", nominalMissingEvents: 0,
      providerChargeUsd: i === 0 ? "3" : "0", clientUsd: i === 0 ? "3.3" : "1.2",
      sourceQuality: "complete", displayDiverged: false,
    }));
    render(<CostSourceAudit audit={{ status: "available", currency: "USD", reason: null, rows }} />);
    expect(screen.getByText("US$18.00")).toBeTruthy();
    expect(screen.getByText("1–15 of 16 source groups")).toBeTruthy();
    expect(screen.queryByText("Model 15")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Next source groups" }));
    expect(screen.getByText("Model 15")).toBeTruthy();
    expect(screen.getByText("16–16 of 16 source groups")).toBeTruthy();
  });
});

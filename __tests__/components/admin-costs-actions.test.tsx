import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { requestProjectInvoice } = vi.hoisted(() => ({
  requestProjectInvoice: vi.fn(),
}));

vi.mock("@/actions/admin/costs", () => ({
  requestProjectInvoice,
  recordManualProjectCost: vi.fn(),
  retryProjectCostEmail: vi.fn(),
  runManualCostSync: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { RequestInvoiceButton } from "@/app/(admin)/admin/costs/cost-actions";

describe("admin costs invoice button", () => {
  it("renders the frozen invoice request label", () => {
    requestProjectInvoice.mockResolvedValue({ data: { requestId: "req_1" } });
    render(
      <RequestInvoiceButton label="Request an invoice for £12.00" disabled={false} />,
    );
    expect(
      screen.getByRole("button", { name: "Request an invoice for £12.00" }),
    ).not.toBeNull();
  });
});

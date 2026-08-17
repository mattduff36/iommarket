import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireRoleMock,
  confirmInvoiceRequestMock,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  confirmInvoiceRequestMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireRole: requireRoleMock,
}));

vi.mock("@/lib/admin/audit", () => ({
  logAdminAction: vi.fn(),
}));

vi.mock("@/lib/costs/invoices", async () => {
  const actual = await vi.importActual<typeof import("@/lib/costs/invoices")>(
    "@/lib/costs/invoices",
  );
  return {
    ...actual,
    confirmInvoiceRequest: confirmInvoiceRequestMock,
  };
});

vi.mock("@/lib/monitoring", () => ({
  reportHandledException: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { confirmProjectInvoice } from "@/actions/admin/costs";

describe("COST-CONFIRM-002 owner-only confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COSTS_ENABLED = "true";
    process.env.COST_OWNER_AUTH_USER_ID = "owner-auth";
  });

  it("rejects a non-owner admin, including direct server-action invocation", async () => {
    requireRoleMock.mockResolvedValue({
      id: "admin_2",
      authUserId: "other-admin",
      role: "ADMIN",
    });

    await expect(
      confirmProjectInvoice({ requestId: "clxxxxxxxxxxxxxxxxxxxxxxx" }),
    ).rejects.toThrow("Insufficient permissions");
    expect(confirmInvoiceRequestMock).not.toHaveBeenCalled();
  });

  it("allows the configured owner to confirm", async () => {
    requireRoleMock.mockResolvedValue({
      id: "admin_1",
      authUserId: "owner-auth",
      role: "ADMIN",
    });
    confirmInvoiceRequestMock.mockResolvedValue({
      request: { id: "clxxxxxxxxxxxxxxxxxxxxxxx" },
      alreadyConfirmed: false,
    });

    const result = await confirmProjectInvoice({
      requestId: "clxxxxxxxxxxxxxxxxxxxxxxx",
    });
    expect(result).toEqual({
      data: { requestId: "clxxxxxxxxxxxxxxxxxxxxxxx", alreadyConfirmed: false },
    });
  });
});

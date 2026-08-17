import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireRoleMock,
  confirmInvoiceRequestMock,
  runCostSyncMock,
  reportHandledExceptionMock,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  confirmInvoiceRequestMock: vi.fn(),
  runCostSyncMock: vi.fn(),
  reportHandledExceptionMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireRole: requireRoleMock,
}));

vi.mock("@/lib/admin/audit", () => ({
  logAdminAction: vi.fn(),
}));

vi.mock("@/lib/costs/invoices", () => ({
  confirmInvoiceRequest: confirmInvoiceRequestMock,
  createInvoiceRequest: vi.fn(),
  safeInvoiceAuditDetails: (details: unknown) => details,
  CostInvoiceError: class CostInvoiceError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "CostInvoiceError";
    }
  },
}));

vi.mock("@/lib/costs/sync", () => ({
  runCostSync: runCostSyncMock,
}));

vi.mock("@/lib/monitoring", () => ({
  reportHandledException: reportHandledExceptionMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/actions/admin/revalidate-costs", () => ({
  revalidateCostPages: vi.fn(),
}));

async function loadCostActions() {
  return import("@/actions/admin/costs");
}

describe("COST-CONFIRM-002 owner-only confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COSTS_ENABLED = "true";
    process.env.COST_OWNER_AUTH_USER_ID = "owner-auth";
  });

  it(
    "rejects a non-owner admin, including direct server-action invocation",
    async () => {
      requireRoleMock.mockResolvedValue({
        id: "admin_2",
        authUserId: "other-admin",
        role: "ADMIN",
      });

      const { confirmProjectInvoice } = await loadCostActions();
      await expect(
        confirmProjectInvoice({ requestId: "clxxxxxxxxxxxxxxxxxxxxxxx" }),
      ).rejects.toThrow("Insufficient permissions");
      expect(confirmInvoiceRequestMock).not.toHaveBeenCalled();
    },
    10_000,
  );

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

    const { confirmProjectInvoice } = await loadCostActions();
    const result = await confirmProjectInvoice({
      requestId: "clxxxxxxxxxxxxxxxxxxxxxxx",
    });
    expect(result).toEqual({
      data: { requestId: "clxxxxxxxxxxxxxxxxxxxxxxx", alreadyConfirmed: false },
    });
  });
});

describe("manual cost sync T4", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COSTS_ENABLED = "true";
    process.env.COST_OWNER_AUTH_USER_ID = "owner-auth";
    requireRoleMock.mockResolvedValue({
      id: "admin_1",
      authUserId: "owner-auth",
      role: "ADMIN",
    });
  });

  it("returns a success payload only when sync succeeded", async () => {
    const { runManualCostSync } = await loadCostActions();
    runCostSyncMock.mockResolvedValue({ status: "succeeded" });
    await expect(runManualCostSync()).resolves.toMatchObject({
      data: { status: "succeeded" },
    });

    runCostSyncMock.mockResolvedValue({ status: "failed" });
    await expect(runManualCostSync()).resolves.toMatchObject({
      error: expect.stringMatching(/failed/i),
      data: { status: "failed" },
    });

    runCostSyncMock.mockResolvedValue({ status: "locked" });
    await expect(runManualCostSync()).resolves.toMatchObject({
      error: expect.stringMatching(/already running/i),
      data: { status: "locked" },
    });

    runCostSyncMock.mockResolvedValue({ status: "skipped" });
    await expect(runManualCostSync()).resolves.toMatchObject({
      error: expect.stringMatching(/skipped/i),
      data: { status: "skipped" },
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { runSerializableMock, fakeTx } = vi.hoisted(() => {
  const fakeTx = {
    invoiceRequest: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    invoiceRequestLine: { createMany: vi.fn() },
    costWorkflowEvent: { create: vi.fn() },
    costEmailOutbox: { create: vi.fn() },
    costSettlement: { createMany: vi.fn() },
    costEntry: { findMany: vi.fn() },
  };
  return {
    fakeTx,
    runSerializableMock: vi.fn(async (fn: (tx: typeof fakeTx) => unknown) => fn(fakeTx)),
  };
});

vi.mock("@/lib/costs/transaction", () => ({
  runSerializable: runSerializableMock,
}));

import {
  confirmInvoiceRequest,
  createInvoiceRequest,
  CostInvoiceError,
} from "@/lib/costs/invoices";

const invoiceableEntry = {
  id: "entry_1",
  markedGbpMinor: 1200n,
  createdAt: new Date("2026-09-02T00:00:00.000Z"),
};

describe("COST-REQUEST-001 pending invoice uniqueness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeTx.invoiceRequest.findUnique.mockResolvedValue(null);
    fakeTx.costEntry.findMany.mockResolvedValue([invoiceableEntry]);
    fakeTx.invoiceRequest.create.mockResolvedValue({
      id: "req_1",
      status: "PENDING",
      frozenGbpMinor: 1200n,
    });
    fakeTx.costEmailOutbox.create.mockResolvedValue({ id: "outbox_1" });
  });

  it("creates one pending request with exact frozen entry links", async () => {
    const created = await createInvoiceRequest({ requesterUserId: "admin_1" });
    expect(created.request.id).toBe("req_1");
    expect(fakeTx.invoiceRequestLine.createMany).toHaveBeenCalledWith({
      data: [
        {
          invoiceRequestId: "req_1",
          costEntryId: "entry_1",
          markedGbpMinor: 1200n,
        },
      ],
    });
    expect(fakeTx.costEmailOutbox.create).toHaveBeenCalled();
  });

  it("rejects a second concurrent open request", async () => {
    fakeTx.invoiceRequest.findUnique.mockResolvedValue({ id: "req_open" });
    await expect(createInvoiceRequest({ requesterUserId: "admin_1" })).rejects.toBeInstanceOf(
      CostInvoiceError,
    );
  });
});

describe("COST-REQUEST-002 later costs stay outstanding", () => {
  it("freezes only the selected entries at request time", async () => {
    fakeTx.invoiceRequest.findUnique.mockResolvedValue(null);
    fakeTx.costEntry.findMany.mockResolvedValue([invoiceableEntry]);
    fakeTx.invoiceRequest.create.mockResolvedValue({ id: "req_1" });
    fakeTx.costEmailOutbox.create.mockResolvedValue({ id: "outbox_1" });

    const created = await createInvoiceRequest({ requesterUserId: "admin_1" });
    expect(created.entryIds).toEqual(["entry_1"]);
    expect(created.entryIds).not.toContain("entry_later");
  });
});

describe("COST-CONFIRM-001 exactly-once confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeTx.invoiceRequest.findUnique.mockResolvedValue({
      id: "req_1",
      status: "PENDING",
      lines: [{ costEntryId: "entry_1", markedGbpMinor: 1200n }],
    });
    fakeTx.invoiceRequest.updateMany.mockResolvedValue({ count: 1 });
    fakeTx.invoiceRequest.findUniqueOrThrow.mockResolvedValue({
      id: "req_1",
      status: "CONFIRMED",
    });
  });

  it("creates one settlement per frozen entry", async () => {
    const result = await confirmInvoiceRequest({
      requestId: "req_1",
      confirmerUserId: "owner_1",
    });
    expect(result.alreadyConfirmed).toBe(false);
    expect(fakeTx.costSettlement.createMany).toHaveBeenCalledWith({
      data: [
        {
          costEntryId: "entry_1",
          invoiceRequestId: "req_1",
          markedGbpMinor: 1200n,
        },
      ],
    });
  });

  it("is idempotent when already confirmed", async () => {
    fakeTx.invoiceRequest.findUnique.mockResolvedValue({
      id: "req_1",
      status: "CONFIRMED",
      lines: [],
    });
    const result = await confirmInvoiceRequest({
      requestId: "req_1",
      confirmerUserId: "owner_1",
    });
    expect(result.alreadyConfirmed).toBe(true);
    expect(fakeTx.costSettlement.createMany).not.toHaveBeenCalled();
  });
});

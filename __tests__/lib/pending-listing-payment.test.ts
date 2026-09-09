import { beforeEach, describe, expect, it, vi } from "vitest";

const { paymentFindFirst, paymentCreate, paymentUpdate } = vi.hoisted(() => ({
  paymentFindFirst: vi.fn(),
  paymentCreate: vi.fn(),
  paymentUpdate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    payment: {
      findFirst: paymentFindFirst,
      create: paymentCreate,
      update: paymentUpdate,
    },
  },
}));

import { persistPendingListingPayment } from "@/lib/payments/pending-listing-payment";

describe("persistPendingListingPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("RIP-PEND-001 inserts one PENDING row keyed by the signed provider reference", async () => {
    paymentFindFirst.mockResolvedValue(null);
    paymentCreate.mockResolvedValue({
      id: "pending-1",
      listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
      status: "PENDING",
    });

    const result = await persistPendingListingPayment({
      listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
      merchantReference: "v1:listing_payment:caaaaaaaaaaaaaaaaaaaaaaaa:n1:mac",
      amountPence: 499,
    });

    expect(result.alreadyPaid).toBe(false);
    expect(paymentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
        providerReference: "v1:listing_payment:caaaaaaaaaaaaaaaaaaaaaaaa:n1:mac",
        status: "PENDING",
        type: "LISTING",
        amount: 499,
        idempotencyKey:
          "ripple-pending:LISTING:caaaaaaaaaaaaaaaaaaaaaaaa:initial",
      }),
    });
    expect(paymentUpdate).not.toHaveBeenCalled();
  });

  it("RIP-PEND-002 reuses the same PENDING row on a second checkout open", async () => {
    paymentFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "pending-1",
        listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
        status: "PENDING",
      });
    paymentUpdate.mockResolvedValue({
      id: "pending-1",
      providerReference: "v1:listing_payment:caaaaaaaaaaaaaaaaaaaaaaaa:n2:mac",
    });

    const result = await persistPendingListingPayment({
      listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
      merchantReference: "v1:listing_payment:caaaaaaaaaaaaaaaaaaaaaaaa:n2:mac",
      amountPence: 499,
    });

    expect(result.alreadyPaid).toBe(false);
    expect(paymentCreate).not.toHaveBeenCalled();
    expect(paymentUpdate).toHaveBeenCalledWith({
      where: { id: "pending-1" },
      data: expect.objectContaining({
        providerReference: "v1:listing_payment:caaaaaaaaaaaaaaaaaaaaaaaa:n2:mac",
      }),
    });
  });

  it("does not insert PENDING after a SUCCEEDED listing fee", async () => {
    paymentFindFirst.mockResolvedValue({
      id: "paid-1",
      status: "SUCCEEDED",
    });

    const result = await persistPendingListingPayment({
      listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
      merchantReference: "v1:listing_payment:caaaaaaaaaaaaaaaaaaaaaaaa:n3:mac",
      amountPence: 499,
    });

    expect(result.alreadyPaid).toBe(true);
    expect(paymentCreate).not.toHaveBeenCalled();
    expect(paymentUpdate).not.toHaveBeenCalled();
  });

  it("creates a new PENDING cycle for an expired listing renewal", async () => {
    paymentFindFirst
      .mockResolvedValueOnce({
        id: "paid-1",
        status: "SUCCEEDED",
      })
      .mockResolvedValueOnce(null);
    paymentCreate.mockResolvedValue({
      id: "renewal-pending",
      listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
      status: "PENDING",
    });

    const result = await persistPendingListingPayment({
      listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
      merchantReference:
        "v1:listing_payment:caaaaaaaaaaaaaaaaaaaaaaaa:renewal:mac",
      amountPence: 499,
      allowNewAfterSucceeded: true,
    });

    expect(result.alreadyPaid).toBe(false);
    expect(paymentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "PENDING",
        providerReference:
          "v1:listing_payment:caaaaaaaaaaaaaaaaaaaaaaaa:renewal:mac",
        idempotencyKey:
          "ripple-pending:LISTING:caaaaaaaaaaaaaaaaaaaaaaaa:paid-1",
      }),
    });
  });
});

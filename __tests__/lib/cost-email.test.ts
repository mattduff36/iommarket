import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findUniqueMock,
  updateManyMock,
  updateMock,
  sendResendEmailMock,
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  updateManyMock: vi.fn(),
  updateMock: vi.fn(),
  sendResendEmailMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    costEmailOutbox: {
      findUnique: findUniqueMock,
      updateMany: updateManyMock,
      update: updateMock,
    },
  },
}));

vi.mock("@/lib/email/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/client")>();
  return {
    ...actual,
    sendResendEmail: sendResendEmailMock,
  };
});

import { deliverCostOutbox } from "@/lib/costs/email";

describe("COST-EMAIL-001 transactional outbox delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COST_OWNER_NOTIFICATION_EMAIL = "owner@example.com";
    process.env.NEXT_PUBLIC_APP_URL = "https://itrader.im";
    findUniqueMock.mockResolvedValue({
      id: "outbox_1",
      status: "PENDING",
      request: {
        id: "req_1",
        frozenGbpMinor: 1200n,
      },
    });
    updateManyMock.mockResolvedValue({ count: 1 });
    updateMock.mockResolvedValue({});
  });

  it("sends once and records success after a claimed outbox row", async () => {
    sendResendEmailMock.mockResolvedValue(undefined);
    await deliverCostOutbox("outbox_1");
    expect(sendResendEmailMock).toHaveBeenCalledTimes(1);
    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SENDING" }),
      }),
    );
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SENT" }),
      }),
    );
    const payload = JSON.stringify(sendResendEmailMock.mock.calls[0][0]);
    expect(payload).toContain("£12.00");
    expect(payload).not.toMatch(/native|fx|markup/i);
  });

  it("keeps the outbox retryable after Resend failure", async () => {
    sendResendEmailMock.mockRejectedValue(new Error("Resend down"));
    await expect(deliverCostOutbox("outbox_1")).rejects.toThrow("Resend down");
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
  });
});

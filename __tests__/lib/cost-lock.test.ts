import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateMany } = vi.hoisted(() => ({
  updateMany: vi.fn(),
}));

vi.mock("@/lib/costs/db", () => ({
  costDb: {
    costSyncLock: {
      updateMany,
    },
  },
}));

import { renewCostSyncLock } from "@/lib/costs/lock";

describe("cost sync lease renewal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not resurrect a lease after it has expired or changed owner", async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await expect(renewCostSyncLock("holder-1")).resolves.toBe(false);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "default",
        holder: "holder-1",
        expiresAt: { gt: expect.any(Date) },
      },
      data: {
        expiresAt: expect.any(Date),
      },
    });
  });
});

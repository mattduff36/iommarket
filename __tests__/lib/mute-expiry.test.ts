import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, updateMany, createEvent } = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  createEvent: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    monitoringIssue: {
      findMany,
      updateMany,
    },
    monitoringIssueStatusEvent: {
      create: createEvent,
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        monitoringIssue: { updateMany },
        monitoringIssueStatusEvent: { create: createEvent },
      }),
  },
}));

import { expireMutedMonitoringIssues } from "@/lib/monitoring/mute-expiry";

describe("mute expiry ALR-MON-001", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("unmutes expired issues once and writes a status event", async () => {
    findMany.mockResolvedValue([{ id: "issue-1", status: "MUTED" }]);
    updateMany.mockResolvedValue({ count: 1 });

    await expect(expireMutedMonitoringIssues()).resolves.toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "issue-1",
        status: "MUTED",
      }),
      data: { status: "OPEN", mutedUntil: null },
    });
    expect(createEvent).toHaveBeenCalledWith({
      data: expect.objectContaining({
        issueId: "issue-1",
        fromStatus: "MUTED",
        toStatus: "OPEN",
      }),
    });
  });

  it("skips event writes when another worker already unmuted the row", async () => {
    findMany.mockResolvedValue([{ id: "issue-1", status: "MUTED" }]);
    updateMany.mockResolvedValue({ count: 0 });

    await expect(expireMutedMonitoringIssues()).resolves.toBe(0);
    expect(createEvent).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const healthUpsert = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    monitoringIssue: { findUnique, upsert: vi.fn() },
    monitoringPipelineHealth: { upsert: healthUpsert },
  },
}));

describe("monitoring capture fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockRejectedValue(new Error("database unavailable"));
    healthUpsert.mockResolvedValue({});
  });

  it("logs a structured fallback instead of throwing when capture cannot persist", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { captureException } = await import("@/lib/monitoring/capture");

    await expect(captureException({
      source: "SERVER",
      error: new Error("payment failed"),
    })).resolves.toBeNull();

    expect(errorSpy).toHaveBeenCalled();
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain("\"monitoringFallback\":true");
    expect(healthUpsert).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

import { describe, expect, it, vi } from "vitest";
import { classifySyncCounts } from "@/lib/database-sync/plan-counts";
import { logSyncFailure, sanitizeSyncError, type SyncTrace } from "@/lib/database-sync/diagnostics";

const trace: SyncTrace = {
  referenceId: "11111111-1111-4111-8111-111111111111",
  startedAt: Date.now(),
  phase: "source snapshot",
  subphase: "source.table-page",
  operation: "source",
  table: "User",
};

describe("database sync diagnostics", () => {
  it("keeps SQLSTATE and drops secrets, parameters and PostgreSQL detail", () => {
    const error = Object.assign(new Error("failed postgres://user:password@db.example/postgres token=abc"), {
      code: "42501",
      detail: "Key (email)=(person@example.com)",
      hint: "password=hidden",
      where: "parameters: secret",
    });
    const sanitized = sanitizeSyncError(error);
    expect(sanitized.code).toBe("42501");
    expect(sanitized.message).toContain("[redacted]");
    expect(sanitized.message).not.toContain("postgres://");
    expect(sanitized.message).not.toContain("person@example.com");
    expect(sanitized).not.toHaveProperty("detail");
  });

  it("logs only the sanitized fields", () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = Object.assign(new Error("copy failed"), { code: "42P01", detail: "customer row" });
    logSyncFailure(trace, error, { NODE_ENV: "test" });
    expect(errorLog).toHaveBeenCalledWith("Database sync failure.", expect.objectContaining({
      referenceId: trace.referenceId,
      phase: "source snapshot",
      subphase: "source.table-page",
      operation: "source",
      table: "User",
      code: "42P01",
      message: "copy failed",
      commit: "unknown",
    }));
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("customer row");
    errorLog.mockRestore();
  });
});

describe("merge plan counts", () => {
  it("separates captured source rows from calculated merge actions", () => {
    const counts = classifySyncCounts({
      mode: "merge",
      sourceKeys: ["admin", "existing", "new"],
      destinationKeys: ["admin", "existing", "development-only"],
      skippedSourceKeys: ["admin"],
      preservedDestinationKeys: ["admin"],
    });
    expect(counts).toEqual({ captured: 3, insert: 1, update: 1, delete: 0, preserve: 2, skip: 1 });
  });

  it("counts replace removals separately from preserved development rows", () => {
    const counts = classifySyncCounts({
      mode: "replace",
      sourceKeys: ["admin", "new"],
      destinationKeys: ["admin", "development-only"],
      skippedSourceKeys: ["admin"],
      preservedDestinationKeys: ["admin"],
    });
    expect(counts).toEqual({ captured: 2, insert: 1, update: 0, delete: 1, preserve: 1, skip: 1 });
  });
});

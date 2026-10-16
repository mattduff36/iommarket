import { describe, expect, it } from "vitest";
import {
  applyDatabaseSyncAction,
  loadDatabaseSyncPreflight,
  loadDatabaseSyncRuns,
  prepareDatabaseSyncAction,
  restoreDatabaseSyncAction,
} from "@/actions/admin/database-sync";

describe("retired database sync actions", () => {
  it("fails closed for every legacy operation", async () => {
    const operations = await Promise.all([
      loadDatabaseSyncPreflight(), loadDatabaseSyncRuns(),
      prepareDatabaseSyncAction("merge"),
      applyDatabaseSyncAction({ runId: "00000000-0000-0000-0000-000000000000", confirmation: "MERGE INTO DEVELOPMENT" }),
      restoreDatabaseSyncAction({ runId: "00000000-0000-0000-0000-000000000000", confirmation: "RESTORE DEVELOPMENT" }),
    ]);
    expect(operations.every((result) => "error" in result)).toBe(true);
  });
});

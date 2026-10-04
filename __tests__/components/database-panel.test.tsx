// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SYNC_TABLES, type SyncTableCounts } from "@/lib/database-sync/types";
import type { PublicDatabaseSyncRun } from "@/actions/admin/database-sync";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), apply: vi.fn(), restore: vi.fn() }));
vi.mock("@/actions/admin/database-sync", () => ({ prepareDatabaseSyncAction: mocks.prepare, applyDatabaseSyncAction: mocks.apply, restoreDatabaseSyncAction: mocks.restore }));
import { DatabasePanel } from "@/app/(admin)/admin/database/database-panel";

const plan = {
  id: "c3c64ad4-1d3e-4aeb-a02a-39a2c6c45a67", mode: "merge", status: "prepared",
  createdAt: "2026-10-03T12:00:00Z", expiresAt: "2026-10-03T12:15:00Z",
  counts: Object.fromEntries(SYNC_TABLES.map((table) => [table, { captured: 5, insert: 1, update: 2, delete: 0, preserve: 2, skip: 0 }])) as SyncTableCounts,
  blockers: [],
  archivedListings: 0, archivedDealers: 0,
  kind: "sync", restoreAvailable: false, backupExpiresAt: null, backupState: "none", restoredFromId: null,
} as PublicDatabaseSyncRun;

beforeEach(() => { vi.clearAllMocks(); mocks.prepare.mockResolvedValue({ data: plan }); mocks.apply.mockResolvedValue({ data: { ...plan, status: "applied" } }); });
afterEach(cleanup);

describe("database management panel", () => {
  it("acknowledges a plan request while preparation is running", async () => {
    let resolvePrepare!: (value: { data: PublicDatabaseSyncRun }) => void;
    mocks.prepare.mockReturnValue(new Promise((resolve) => { resolvePrepare = resolve; }));
    render(<DatabasePanel initialRuns={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Preview merge plan" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Request received. Preparing the merge plan");
    expect(screen.getByRole("button", { name: "Preparing merge plan…" })).toBeDisabled();
    resolvePrepare({ data: plan });
    await screen.findByRole("heading", { name: "Review: Merge production into development" });
    expect(screen.getByRole("status")).toHaveTextContent("Plan prepared for merge production into development");
  });

  it("previews counts before requiring the exact confirmation to apply", async () => {
    render(<DatabasePanel initialRuns={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview merge plan" }));
    await screen.findByRole("heading", { name: "Review: Merge production into development" });
    expect(mocks.prepare).toHaveBeenCalledWith("merge");
    expect(screen.getByRole("table")).toHaveTextContent("Captured is the production snapshot size");
    expect(screen.getByRole("table")).toHaveTextContent("Captured");
    expect(screen.getByRole("table")).toHaveTextContent("5");
    expect(screen.getByRole("table")).toHaveTextContent("Preserve");
    expect(screen.getByText(/Production values are copied as stored, including featured listings/)).toBeInTheDocument();
    const apply = screen.getByRole("button", { name: "Apply merge to development" });
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type MERGE INTO DEVELOPMENT to confirm"), { target: { value: "MERGE INTO DEVELOPMENT" } });
    let resolveApply!: (value: { data: PublicDatabaseSyncRun }) => void;
    mocks.apply.mockReturnValue(new Promise((resolve) => { resolveApply = resolve; }));
    fireEvent.click(apply);
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledWith({ runId: plan.id, confirmation: "MERGE INTO DEVELOPMENT" }));
    expect(screen.getByRole("status")).toHaveTextContent("Confirmation received. Applying the merge plan");
    expect(screen.getByRole("button", { name: "Applying merge…" })).toBeDisabled();
    resolveApply({ data: { ...plan, status: "applied" } });
    await screen.findByText("Merge production into development completed. Production was not changed.");
  });

  it("shows blockers without offering Apply", async () => {
    mocks.prepare.mockResolvedValue({ data: { ...plan, blockers: ["A reference conflict must be resolved."] } });
    render(<DatabasePanel initialRuns={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview merge plan" }));
    await screen.findByText("A reference conflict must be resolved.");
    expect(screen.queryByRole("button", { name: "Apply merge to development" })).not.toBeInTheDocument();
  });

  it("explains Reset clearing and uses its own confirmation", async () => {
    mocks.prepare.mockResolvedValue({ data: { ...plan, mode: "reset" } });
    render(<DatabasePanel initialRuns={[]} />);
    expect(screen.getByText(/Remove development marketplace rows/)).toHaveTextContent("staging administrator sign-in");
    fireEvent.click(screen.getByRole("button", { name: "Preview reset plan" }));
    await screen.findByLabelText("Type RESET DEVELOPMENT to confirm");
    expect(mocks.prepare).toHaveBeenCalledWith("reset");
  });

  it("offers restore only for a retained applied backup and requires the exact confirmation", async () => {
    const applied = { ...plan, status: "applied" as const, restoreAvailable: true, backupState: "retained" as const, backupExpiresAt: "2026-11-03T12:00:00Z" };
    let resolveRestore!: (value: { data: PublicDatabaseSyncRun }) => void;
    mocks.restore.mockReturnValue(new Promise((resolve) => { resolveRestore = resolve; }));
    render(<DatabasePanel initialRuns={[applied, { ...plan, id: "prepared-run", status: "prepared" }]} />);
    expect(screen.getByText(/Backup expires/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Restore" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    const confirm = await screen.findByLabelText("Type RESTORE DEVELOPMENT to confirm");
    fireEvent.change(confirm, { target: { value: "RESTORE DEVELOPMENT" } });
    fireEvent.click(screen.getByRole("button", { name: "Restore this backup" }));
    await waitFor(() => expect(mocks.restore).toHaveBeenCalledWith({ runId: applied.id, confirmation: "RESTORE DEVELOPMENT" }));
    expect(screen.getByRole("status")).toHaveTextContent("Confirmation received. Restoring the selected development backup");
    expect(screen.getByRole("button", { name: "Restoring backup…" })).toBeDisabled();
    resolveRestore({ data: { ...applied, id: "restored-run", kind: "restore" } });
    await screen.findByText("Development was restored from the selected backup. Production was not changed.");
  });
});

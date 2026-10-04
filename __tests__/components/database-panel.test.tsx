// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SYNC_TABLES, type SyncTableCounts } from "@/lib/database-sync/types";
import type { PublicDatabaseSyncRun } from "@/actions/admin/database-sync";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), apply: vi.fn() }));
vi.mock("@/actions/admin/database-sync", () => ({ prepareDatabaseSyncAction: mocks.prepare, applyDatabaseSyncAction: mocks.apply }));
import { DatabasePanel } from "@/app/(admin)/admin/database/database-panel";

const plan = {
  id: "c3c64ad4-1d3e-4aeb-a02a-39a2c6c45a67", mode: "merge", status: "prepared",
  createdAt: "2026-10-03T12:00:00Z", expiresAt: "2026-10-03T12:15:00Z",
  counts: Object.fromEntries(SYNC_TABLES.map((table) => [table, { insert: 1, update: 0, delete: 0, preserve: 2, skip: 0 }])) as SyncTableCounts,
  blockers: [],
  archivedListings: 302, archivedDealers: 13,
} as PublicDatabaseSyncRun;

beforeEach(() => { vi.clearAllMocks(); mocks.prepare.mockResolvedValue({ data: plan }); mocks.apply.mockResolvedValue({ data: { ...plan, status: "applied" } }); });
afterEach(cleanup);

describe("database management panel", () => {
  it("previews counts before requiring the exact confirmation to apply", async () => {
    render(<DatabasePanel initialRuns={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview merge plan" }));
    await screen.findByRole("heading", { name: "Review: Merge production into development" });
    expect(mocks.prepare).toHaveBeenCalledWith("merge");
    expect(screen.getByRole("table")).toHaveTextContent("Preserve");
    expect(screen.getByText(/Archive and hide: 302 listings and 13 dealer profiles/)).toHaveTextContent("physical deletions only");
    const apply = screen.getByRole("button", { name: "Apply merge to development" });
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type MERGE INTO DEVELOPMENT to confirm"), { target: { value: "MERGE INTO DEVELOPMENT" } });
    fireEvent.click(apply);
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledWith({ runId: plan.id, confirmation: "MERGE INTO DEVELOPMENT" }));
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
    expect(screen.getByText(/Clear ordinary development marketplace data/)).toHaveTextContent("preserving administrators");
    fireEvent.click(screen.getByRole("button", { name: "Preview reset plan" }));
    await screen.findByLabelText("Type RESET DEVELOPMENT to confirm");
    expect(mocks.prepare).toHaveBeenCalledWith("reset");
  });
});

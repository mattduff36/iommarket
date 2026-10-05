// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicDatabaseSyncRun } from "@/actions/admin/database-sync";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), apply: vi.fn(), history: vi.fn() }));
vi.mock("@/actions/admin/database-sync", () => ({ prepareDatabaseSyncAction: mocks.prepare, applyDatabaseSyncAction: mocks.apply, loadDatabaseSyncRuns: mocks.history }));
import { DatabasePanel } from "@/app/(admin)/admin/database/database-panel";

const plan: PublicDatabaseSyncRun = {
  id: "c3c64ad4-1d3e-4aeb-a02a-39a2c6c45a67", mode: "merge", status: "prepared",
  createdAt: "2026-10-05T03:00:00Z", expiresAt: "2026-10-05T03:30:00Z",
  counts: { User: { captured: 5, insert: 1, update: 2, delete: 0, preserve: 2, skip: 0 } },
  blockers: [], archivedListings: 0, archivedDealers: 0, reconciled: [],
  kind: "sync", restoreAvailable: false, backupExpiresAt: null, backupState: "none", restoredFromId: null,
};
const applied: PublicDatabaseSyncRun = { ...plan, status: "applied", backupState: "newest" };
const scroll = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = scroll;
  mocks.prepare.mockResolvedValue({ data: plan });
  mocks.apply.mockResolvedValue({ data: applied });
  mocks.history.mockResolvedValue({ data: [applied] });
});
afterEach(cleanup);

async function openPlan() {
  fireEvent.click(screen.getByRole("button", { name: "Preview merge plan" }));
  await screen.findByRole("heading", { name: "Review: Merge production into development" });
  fireEvent.change(screen.getByLabelText("Type MERGE INTO DEVELOPMENT to confirm"), { target: { value: "MERGE INTO DEVELOPMENT" } });
}

describe("database panel Apply feedback and disabled layout", () => {
  it("restores all three cards, while Replace, Reset and Restore stay disabled", () => {
    render(<DatabasePanel initialRuns={[applied]} />);
    expect(screen.getByLabelText("Database operations")).toHaveClass("lg:grid-cols-3");
    expect(screen.getByRole("heading", { name: "Replace development" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Reset development" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview replace plan" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Preview reset plan" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Restore" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Preview merge plan" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Preview reset plan" }));
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("focuses and scrolls to immediate preparation acknowledgement", async () => {
    let resolve!: (value: { data: PublicDatabaseSyncRun }) => void;
    mocks.prepare.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<DatabasePanel initialRuns={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview merge plan" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Request received. Preparing the merge plan");
    expect(status).toHaveFocus();
    expect(scroll).toHaveBeenCalled();
    resolve({ data: plan });
    await screen.findByRole("heading", { name: "Review: Merge production into development" });
  });

  it("keeps Apply busy, prevents duplicate submission, then confirms saved success", async () => {
    let resolve!: (value: { data: PublicDatabaseSyncRun }) => void;
    mocks.apply.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<DatabasePanel initialRuns={[]} />);
    await openPlan();
    const button = screen.getByRole("button", { name: "Apply merge to development" });
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status")).toHaveTextContent("Confirmation received. Applying the merge plan");
    expect(screen.getByRole("button", { name: "Applying merge…" })).toBeDisabled();
    resolve({ data: applied });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("completed successfully"));
    expect(screen.getByRole("status")).toHaveFocus();
    expect(screen.getByText("Applied")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Review: Merge production into development" })).not.toBeInTheDocument();
  });

  it("makes a returned server failure visible and retains Prepared instead of implying success", async () => {
    mocks.apply.mockResolvedValue({ error: "The transaction was rolled back. Reference fixture-reference." });
    render(<DatabasePanel initialRuns={[]} />);
    await openPlan();
    fireEvent.click(screen.getByRole("button", { name: "Apply merge to development" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("rolled back");
    expect(alert).toHaveTextContent("fixture-reference");
    expect(alert).toHaveFocus();
    expect(screen.getByText("Prepared")).toBeInTheDocument();
    expect(screen.queryByText("Applied")).not.toBeInTheDocument();
  });

  it("checks saved history after a lost response without submitting another merge", async () => {
    mocks.apply.mockRejectedValue(new Error("Network response lost"));
    render(<DatabasePanel initialRuns={[]} />);
    await openPlan();
    fireEvent.click(screen.getByRole("button", { name: "Apply merge to development" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("connection ended");
    expect(screen.getByRole("button", { name: "Apply merge to development" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh history" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("saved operation is Applied"));
    expect(mocks.apply).toHaveBeenCalledTimes(1);
    expect(mocks.history).toHaveBeenCalledTimes(1);
  });

  it("never treats a Prepared response as completed", async () => {
    mocks.apply.mockResolvedValue({ data: plan });
    render(<DatabasePanel initialRuns={[]} />);
    await openPlan();
    fireEvent.click(screen.getByRole("button", { name: "Apply merge to development" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("did not confirm completion");
    expect(screen.queryByText("Applied")).not.toBeInTheDocument();
  });

  it("still displays blockers without an Apply button", async () => {
    mocks.prepare.mockResolvedValue({ data: { ...plan, blockers: ["A required reference is missing."] } });
    render(<DatabasePanel initialRuns={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview merge plan" }));
    await screen.findByText("A required reference is missing.");
    expect(screen.queryByRole("button", { name: "Apply merge to development" })).not.toBeInTheDocument();
  });
});

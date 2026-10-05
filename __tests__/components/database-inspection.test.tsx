// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSyncInspection } from "@/lib/database-sync/preflight";

const mocks = vi.hoisted(() => ({ inspect: vi.fn() }));
vi.mock("@/actions/admin/database-sync", () => ({ loadDatabaseSyncPreflight: mocks.inspect }));

import { DatabaseInspection } from "@/app/(admin)/admin/database/database-inspection";

const report = {
  ready: true,
  source: "Production database",
  destination: "Development database",
  sourceReadOnlyRole: true,
  schemaCompatible: true,
  migrationsCompatible: true,
  sourceTables: 2,
  destinationTables: 2,
  rows: [{ table: "Listing", production: 4, development: 1 }],
  blockers: [],
} satisfies DatabaseSyncInspection;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inspect.mockResolvedValue({ data: report });
});
afterEach(cleanup);

describe("database inspection", () => {
  it("runs a fresh inspection with loading acknowledgement and replaces the report", async () => {
    let resolveInspection!: (value: { data: DatabaseSyncInspection }) => void;
    mocks.inspect.mockReturnValue(new Promise((resolve) => { resolveInspection = resolve; }));
    render(<DatabaseInspection initialReport={report} />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh inspection" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Refresh requested. Inspecting both databases");
    expect(screen.getByRole("button", { name: "Refreshing inspection…" })).toBeDisabled();
    resolveInspection({
      data: {
        ...report,
        rows: [{ table: "Listing", production: 7, development: 3 }],
      },
    });

    expect(await screen.findByText("7")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Inspection refreshed"));
    expect(mocks.inspect).toHaveBeenCalledOnce();
  });

  it("keeps the previous report when refresh fails", async () => {
    mocks.inspect.mockResolvedValue({ error: "Database inspection could not be completed. Try again shortly." });
    render(<DatabaseInspection initialReport={report} />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh inspection" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Database inspection could not be completed");
    expect(screen.getByText("4")).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refreshMock, signOutMock, replaceMock, refreshRouteMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(), signOutMock: vi.fn(), replaceMock: vi.fn(), refreshRouteMock: vi.fn(),
}));
vi.mock("@/actions/admin/preview-mirror", () => ({ refreshPreviewMirrorAction: refreshMock }));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => ({ auth: { signOut: signOutMock } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: replaceMock, refresh: refreshRouteMock }) }));
import { DatabasePanel } from "@/app/(admin)/admin/database/database-panel";

const initialStatus = { lastSuccessAt: "2026-10-09T09:00:00Z", nextAutomaticAt: "2026-10-12T09:00:00Z", lastError: null };
beforeEach(() => {
  vi.clearAllMocks();
  refreshMock.mockResolvedValue({ data: { status: "applied", copiedRows: 42 } });
  signOutMock.mockResolvedValue({ error: null });
});
afterEach(cleanup);

describe("preview mirror panel", () => {
  it("shows the replacement and sign-out note, schedule, and one refresh action", () => {
    render(<DatabasePanel initialStatus={initialStatus} />);
    expect(screen.getByText(/replaces all preview data, including every account/i)).toBeInTheDocument();
    expect(screen.getByText(/all users will be signed out/i)).toBeInTheDocument();
    expect(screen.getByText(/Last successful refresh/)).toBeInTheDocument();
    expect(screen.getByText(/Next automatic refresh/)).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("reports committed success without another server status read, signs out locally, and navigates to sign-in", async () => {
    render(<DatabasePanel initialStatus={initialStatus} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh from production" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Preview refreshed successfully (42 rows copied). Signing out now.");
    expect(refreshMock).toHaveBeenCalledOnce();
    expect(signOutMock).toHaveBeenCalledWith({ scope: "local" });
    expect(replaceMock).toHaveBeenCalledWith("/sign-in");
    expect(refreshRouteMock).toHaveBeenCalledOnce();
  });

  it("does not claim success for a busy refresh or a server error", async () => {
    refreshMock.mockResolvedValueOnce({ data: { status: "busy" } });
    const { rerender } = render(<DatabasePanel initialStatus={initialStatus} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh from production" }));
    expect(await screen.findByRole("status")).toHaveTextContent("already running");
    refreshMock.mockResolvedValueOnce({ error: "Refresh failed safely." });
    rerender(<DatabasePanel initialStatus={initialStatus} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh from production" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Refresh failed safely");
  });

  it("shows a status error instead of a missing page and disables refresh until status is available", () => {
    render(<DatabasePanel initialStatus={null} initialStatusError="Status database is unavailable." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Refresh status is unavailable: Status database is unavailable.");
    expect(screen.getByRole("button", { name: "Refresh from production" })).toBeDisabled();
    expect(screen.getAllByText("Unavailable")).toHaveLength(2);
  });
});

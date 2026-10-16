// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppError from "@/app/error";
import GlobalError from "@/app/global-error";

const reportClientBoundaryError = vi.fn();

vi.mock("@/lib/monitoring/client-ingest", () => ({
  reportClientBoundaryError: (...args: unknown[]) => reportClientBoundaryError(...args),
}));

describe("MON-BOUNDARY-003 error boundaries", () => {
  beforeEach(() => { reportClientBoundaryError.mockReset(); reportClientBoundaryError.mockResolvedValue(null); });
  afterEach(() => {
    cleanup();
    reportClientBoundaryError.mockReset();
  });

  it("reports a segment error once and keeps retry available", async () => {
    const reset = vi.fn();
    const error = Object.assign(new Error("segment failed"), { digest: "d1" });

    render(<AppError error={error} reset={reset} />);

    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeTruthy();
    expect(screen.queryByText("segment failed")).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Go home" }).getAttribute("href")).toBe("/");
    expect(reportClientBoundaryError).toHaveBeenCalledTimes(1);
    expect(reportClientBoundaryError).toHaveBeenCalledWith({
      error,
      component: "app/error.tsx",
    });
  });

  it("shows a captured reference and clears it for a new error when monitoring fails", async () => {
    reportClientBoundaryError.mockResolvedValueOnce("evt_safe_1234").mockRejectedValueOnce(new Error("ingest failed"));
    const reset = vi.fn();
    const { rerender } = render(<AppError error={new Error("private provider detail")} reset={reset} />);
    await screen.findByText(/evt_safe_1234/);
    expect(screen.getByRole("link", { name: "Contact support" })).toHaveAttribute("href", "mailto:hello@itrader.im");
    rerender(<AppError error={new Error("another secret")} reset={reset} />);
    await waitFor(() => expect(screen.queryByText(/evt_safe_1234/)).toBeNull());
    expect(screen.queryByText(/another secret|private provider detail/)).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  it("reports a global error once and keeps recovery available", async () => {
    const reset = vi.fn();
    const error = Object.assign(new Error("root failed"), { digest: "d2" });

    render(<GlobalError error={error} reset={reset} />);

    expect(screen.getByRole("heading", { name: "Application error" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(reportClientBoundaryError).toHaveBeenCalledTimes(1);
    expect(reportClientBoundaryError).toHaveBeenCalledWith({
      error,
      component: "app/global-error.tsx",
    });
  });
});

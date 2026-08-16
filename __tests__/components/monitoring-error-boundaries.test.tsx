import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppError from "@/app/error";
import GlobalError from "@/app/global-error";

const reportClientBoundaryError = vi.fn();

vi.mock("@/lib/monitoring/client-ingest", () => ({
  reportClientBoundaryError: (...args: unknown[]) => reportClientBoundaryError(...args),
}));

describe("MON-BOUNDARY-003 error boundaries", () => {
  afterEach(() => {
    reportClientBoundaryError.mockReset();
  });

  it("reports a segment error once and keeps retry available", async () => {
    const reset = vi.fn();
    const error = Object.assign(new Error("segment failed"), { digest: "d1" });

    render(<AppError error={error} reset={reset} />);

    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Go home" }).getAttribute("href")).toBe("/");
    expect(reportClientBoundaryError).toHaveBeenCalledTimes(1);
    expect(reportClientBoundaryError).toHaveBeenCalledWith({
      error,
      component: "app/error.tsx",
    });
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

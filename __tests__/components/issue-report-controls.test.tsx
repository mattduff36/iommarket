// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportableError } from "@/components/monitoring/reportable-error";
const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/monitoring/user-report", async () => ({ ...await vi.importActual("@/lib/monitoring/user-report"), sendUserIssueReport: send }));

describe("report controls on displayed errors", () => {
  beforeEach(() => { send.mockReset().mockResolvedValue("event_123456"); });
  afterEach(() => vi.restoreAllMocks());
  it("covers inline and dynamically rendered errors, but not success messages or required markers", async () => {
    const view = render(<><ReportableError as="p" className="text-text-error">Photo verification failed.</ReportableError><ReportableError role="alert" data-reportable-error="false">Saved successfully.</ReportableError><span aria-hidden="true" className="text-text-error">*</span></>);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Report issue" })).toHaveLength(1));
    view.rerender(<><ReportableError role="alert"><ReportableError as="p" className="text-text-error">Connection failed.</ReportableError></ReportableError><ReportableError as="p" className="text-text-error">Another error.</ReportableError></>);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Report issue" })).toHaveLength(2));
  });
  it("submits only the message and pathname once and provides a confirmed reference", async () => {
    render(<><ReportableError role="alert">Could not save.<input defaultValue="secret input" /><button>Try again</button></ReportableError></>);
    const button = await screen.findByRole("button", { name: "Report issue" });
    fireEvent.click(button); fireEvent.click(button);
    await screen.findByText(/Reported. Reference event_123456/);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ message: "Could not save.", route: "/" });
    expect(JSON.stringify(send.mock.calls)).not.toContain("secret input");
    expect(button).toBeDisabled();
  });
  it("keeps the same report id after an uncertain failure and never recursively reports itself", async () => {
    send.mockRejectedValueOnce(new Error("Could not send the report. Try again."));
    render(<><ReportableError as="p" role="alert">Retry photo failed.</ReportableError></>);
    const button = await screen.findByRole("button", { name: "Report issue" });
    fireEvent.click(button);
    await screen.findByText("Could not send the report. Try again.");
    fireEvent.click(button);
    await screen.findByText(/Reported. Reference/);
    expect(send.mock.calls[0][0].reportId).toBe(send.mock.calls[1][0].reportId);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
  it("deduplicates identical batch errors and removes controls when an error becomes ordinary status", async () => {
    const view = render(<><ReportableError as="p" role="alert">Photo failed.</ReportableError><ReportableError as="p" role="alert">Photo failed.</ReportableError></>);
    const buttons = await screen.findAllByRole("button", { name: "Report issue" });
    fireEvent.click(buttons[0]);
    await screen.findByText(/Reported. Reference/);
    fireEvent.click(buttons[1]);
    await waitFor(() => expect(buttons.every(button => (button as HTMLButtonElement).disabled)).toBe(true));
    expect(send).toHaveBeenCalledTimes(1);
    view.rerender(<><ReportableError as="p" role="status">Photo failed.</ReportableError></>);
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
  });
});

it("hydrates a deferred server-rendered error without changing React-owned markup", async () => {
  const React = await import("react");
  const { renderToString } = await import("react-dom/server");
  const { hydrateRoot } = await import("react-dom/client");
  const { act } = await import("@testing-library/react");
  const recover = vi.fn();
  const element = <ReportableError as="p" role="alert">Deferred server error.</ReportableError>;
  const container = document.createElement("div");
  container.innerHTML = renderToString(<React.Suspense>{element}</React.Suspense>);
  document.body.append(container);
  let resolve!: (value: { default: () => React.ReactNode }) => void;
  const Child = React.lazy(() => new Promise<{ default: () => React.ReactNode }>(r => { resolve = r; }));
  let root!: ReturnType<typeof hydrateRoot>;
  await act(async () => { root = hydrateRoot(container, <React.Suspense><Child /></React.Suspense>, { onRecoverableError: recover }); });
  await act(async () => { resolve({ default: () => element }); });
  expect(recover).not.toHaveBeenCalled();
  expect(container.querySelectorAll("button")).toHaveLength(1);
  await act(async () => root.unmount());
  container.remove();
});

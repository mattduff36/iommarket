// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ launch: vi.fn(), navigate: vi.fn(), task: vi.fn(), dispatch: vi.fn() }));
vi.mock("@/app/(admin)/admin/stock-reviews/launch-actions", () => ({ launchStockApp: mocks.launch }));
vi.mock("@/app/(admin)/admin/stock-reviews/app-launch-navigation", () => ({ openStockUpdateProtocol: mocks.navigate }));
import { useStockAppLifecycle } from "@/app/(admin)/admin/stock-reviews/app-lifecycle";
import type { StockWorkerControl } from "@/app/(admin)/admin/stock-reviews/worker-context";
function Harness({ online = false, target = "device:instance", connectedLaunchId }: { online?: boolean; target?: string; connectedLaunchId?: string }) {
  const controls = { online, target, running: false, pending: false, stopping: false, dispatch: mocks.dispatch } as unknown as StockWorkerControl;
  const lifecycle = useStockAppLifecycle(controls, connectedLaunchId);
  return <><button onClick={() => void lifecycle.open()}>Open Stock Update</button>{lifecycle.launchFailed && <button>Download app</button>}<button onClick={() => void lifecycle.requestRun(mocks.task)}>Run task</button>{lifecycle.dialog}<p>{lifecycle.message}</p>{lifecycle.launchFallback}</>;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.task.mockResolvedValue(["job-one"]);
  mocks.launch.mockResolvedValue({ ok: true, url: "protocol-link", launchId: "launch-one" });
  mocks.dispatch.mockResolvedValue("ok");
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("does not queue or launch before offline confirmation, and cancellation has no effects", async () => {
  render(<Harness />);
  fireEvent.click(screen.getByText("Run task"));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(mocks.task).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Cancel"));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(mocks.launch).not.toHaveBeenCalled();
});
it("queues once after confirmation and launches only those jobs as a temporary task", async () => {
  render(<Harness />);
  fireEvent.click(screen.getByText("Run task"));
  fireEvent.click(screen.getByText("Start app and continue"));
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("protocol-link"));
  expect(mocks.task).toHaveBeenCalledTimes(1);
  expect(mocks.launch).toHaveBeenCalledExactlyOnceWith({ mode: "task", jobIds: ["job-one"] });
  expect(mocks.dispatch).not.toHaveBeenCalled();
});
it("retries the same protocol launch from a direct click without queuing or minting twice", async () => {
  render(<Harness />);
  fireEvent.click(screen.getByText("Run task"));
  fireEvent.click(screen.getByText("Start app and continue"));
  fireEvent.click(await screen.findByText("Open app if it did not start"));
  expect(mocks.navigate).toHaveBeenCalledTimes(2);
  expect(mocks.task).toHaveBeenCalledTimes(1);
  expect(mocks.launch).toHaveBeenCalledTimes(1);
});
it("does not launch after an unsuccessful action, and never retries an uncertain action", async () => {
  mocks.task.mockRejectedValue(new Error("response lost"));
  render(<Harness />);
  fireEvent.click(screen.getByText("Run task"));
  fireEvent.click(screen.getByText("Start app and continue"));
  await screen.findByText(/Check the saved task status/);
  expect(mocks.task).toHaveBeenCalledTimes(1);
  expect(mocks.launch).not.toHaveBeenCalled();
});
it("uses the connected instance and preserves its target across an async queue", async () => {
  let finish!: (ids: string[]) => void;
  mocks.task.mockImplementation(() => new Promise<string[]>(resolve => { finish = resolve; }));
  const view = render(<Harness online />);
  fireEvent.click(screen.getByText("Run task"));
  view.rerender(<Harness online target="device:replacement" />);
  await act(async () => finish(["job-one"]));
  expect(mocks.dispatch).toHaveBeenCalledWith("start", "device:instance");
  expect(mocks.launch).not.toHaveBeenCalled();
});

it("shows download only after opening fails and clears it on retry and connection", async () => {
  mocks.launch.mockResolvedValueOnce({ok:false,error:"unavailable"});
  const view = render(<Harness />);
  expect(screen.queryByText("Download app")).not.toBeInTheDocument();
  await act(async () => fireEvent.click(screen.getByText("Open Stock Update")));
  expect(screen.getByText("Download app")).toBeInTheDocument();
  await act(async () => fireEvent.click(screen.getByText("Open Stock Update")));
  expect(screen.queryByText("Download app")).not.toBeInTheDocument();
  view.rerender(<Harness online connectedLaunchId="launch-one" />);
  expect(screen.queryByText("Download app")).not.toBeInTheDocument();
});
it("offers download after the connection timeout and hides it on a late connection", async () => {
  vi.useFakeTimers();
  const view = render(<Harness />);
  await act(async () => fireEvent.click(screen.getByText("Open Stock Update")));
  await act(async () => vi.advanceTimersByTimeAsync(44_999));
  expect(screen.queryByText("Download app")).not.toBeInTheDocument();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(screen.getByText("Download app")).toBeInTheDocument();
  view.rerender(<Harness online connectedLaunchId="launch-one" />);
  expect(screen.queryByText("Download app")).not.toBeInTheDocument();
});

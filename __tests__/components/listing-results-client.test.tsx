// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ListingResultsClient } from "@/components/marketplace/search/listing-results-client";

const routerPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("@/components/marketplace/listing-card", () => ({
  ListingCard: ({ title }: { title: string }) => <div>{title}</div>,
}));

class IntersectionObserverMock {
  private readonly callback: IntersectionObserverCallback;
  private active = true;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  observe() {
    queueMicrotask(() => {
      if (!this.active) return;
      this.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    });
  }
  unobserve() {}
  disconnect() {
    this.active = false;
  }
  takeRecords() {
    return [];
  }
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0];
}

describe("ListingResultsClient pagination", () => {
  it("discards a pending old-query response after filters change", async () => {
    let finish!: (value: unknown) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const item = { id: "new", title: "New filter listing", price: 1, featured: false, categoryName: "Cars", regionName: "Douglas" };
    const { rerender } = render(<ListingResultsClient initialListings={[]} total={2} pageSize={1} queryParams={{ q: "old" }} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const oldSignal = fetchMock.mock.calls[0][1].signal;
    rerender(<ListingResultsClient initialListings={[item]} total={1} pageSize={1} queryParams={{ q: "new" }} />);
    await act(async () => { finish({ ok: true, json: async () => ({ listings: [{ ...item, id: "old", title: "Stale listing" }] }) }); });
    expect(oldSignal?.aborted).toBe(true);
    expect(screen.queryByText("Stale listing")).toBeNull();
    expect(screen.getByText("New filter listing")).toBeTruthy();
  });

  it("clears an old query error when new results arrive", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Load failed"))
      .mockResolvedValue({ ok: true, json: async () => ({ listings: [{ id: "two", title: "Recovered", price: 1, featured: false, categoryName: "Cars", regionName: "Douglas" }] }) });
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<ListingResultsClient initialListings={[]} total={1} pageSize={1} queryParams={{ q: "old" }} />);
    await screen.findByRole("alert");
    rerender(<ListingResultsClient initialListings={[]} total={1} pageSize={1} queryParams={{ q: "new" }} />);
    expect(await screen.findByText("Recovered")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  beforeEach(() => {
    routerPush.mockReset();
    vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("turns a hung request into a reportable timeout with manual recovery", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fetchMock = vi.fn().mockImplementation((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => { render(<ListingResultsClient initialListings={[]} total={1} pageSize={1} queryParams={{}} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(fetchMock.mock.calls[0][1].signal.reason.name).toBe("TimeoutError");
    expect(screen.getByRole("alert").textContent).toContain("Unable to load more listings");
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows a retryable error when loading more listings fails", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Load failed"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          listings: [
            {
              id: "listing-2",
              title: "Second listing",
              price: 120_000,
              featured: false,
              categoryName: "Cars",
              regionName: "Ramsey",
            },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ListingResultsClient
        initialListings={[
          {
            id: "listing-1",
            title: "First listing",
            price: 100_000,
            featured: false,
            categoryName: "Cars",
            regionName: "Douglas",
          },
        ]}
        total={2}
        pageSize={1}
        queryParams={{}}
      />,
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Unable to load more listings",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(screen.getByText("Second listing")).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  beforeEach(() => {
    routerPush.mockReset();
    vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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

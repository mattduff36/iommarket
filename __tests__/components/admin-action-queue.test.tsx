// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AdminActionQueue,
  buildAdminActionQueueItems,
} from "@/components/admin/admin-action-queue";

const EMPTY_COUNTS = {
  listingsAwaitingReview: 0,
  openReports: 0,
  pendingReviews: 0,
  openCancellations: 0,
  openMonitoringIssues: 0,
};

const EXPECTED_HREFS = [
  "/admin/listings?status=PENDING",
  "/admin/reports",
  "/admin/reviews",
  "/admin/cancellations",
  "/admin/monitoring?status=OPEN",
];

const EXPECTED_LABELS = [
  "Listings awaiting review",
  "Open reports",
  "Pending reviews",
  "Open cancellations",
  "Open monitoring issues",
];

const EXPECTED_TONES = ["warning", "error", "warning", "error", "error"];

describe("buildAdminActionQueueItems", () => {
  it("returns the five work queues in dashboard order with the expected hrefs and tones", () => {
    const items = buildAdminActionQueueItems(EMPTY_COUNTS);

    expect(items.map((item) => item.label)).toEqual(EXPECTED_LABELS);
    expect(items.map((item) => item.href)).toEqual(EXPECTED_HREFS);
    expect(items.map((item) => item.tone)).toEqual(EXPECTED_TONES);
  });
});

describe("AdminActionQueue", () => {
  it("always renders five individual cards with Clear badges when counts are zero", () => {
    render(<AdminActionQueue items={buildAdminActionQueueItems(EMPTY_COUNTS)} />);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(5);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(EXPECTED_HREFS);
    expect(screen.queryByRole("heading", { name: "Requires attention" })).toBeNull();
    expect(screen.getAllByText("Clear")).toHaveLength(5);

    for (const label of EXPECTED_LABELS) {
      expect(screen.getByRole("link", { name: `0 ${label}` })).toBeTruthy();
    }
  });

  it("applies semantic urgency tones when a queue has outstanding work", () => {
    render(
      <AdminActionQueue
        items={buildAdminActionQueueItems({
          ...EMPTY_COUNTS,
          listingsAwaitingReview: 2,
          openReports: 3,
        })}
      />,
    );

    const listingsCard = screen
      .getByRole("link", { name: /2 Listings awaiting review/i })
      .closest("[class*='rounded-lg']");
    const reportsCard = screen
      .getByRole("link", { name: /3 Open reports/i })
      .closest("[class*='rounded-lg']");
    const reviewsCard = screen
      .getByRole("link", { name: /0 Pending reviews/i })
      .closest("[class*='rounded-lg']");

    expect(listingsCard?.className).toContain("border-premium-gold-500/30");
    expect(listingsCard?.className).toContain("bg-premium-gold-500/10");
    expect(reportsCard?.className).toContain("border-neon-red-500/30");
    expect(reportsCard?.className).toContain("bg-neon-red-500/10");
    expect(reviewsCard?.className).not.toContain("border-premium-gold-500/30");
    expect(reviewsCard?.className).not.toContain("border-neon-red-500/30");
    expect(reviewsCard?.className).not.toContain("bg-premium-gold-500/10");
    expect(reviewsCard?.className).not.toContain("bg-neon-red-500/10");
    expect(screen.getAllByText("2").find((element) => element.className.includes("text-premium-gold-400"))?.className).toContain("text-premium-gold-400");
    expect(screen.getAllByText("3").find((element) => element.className.includes("text-neon-red-400"))?.className).toContain("text-neon-red-400");
  });
});

 describe("mobile action queue", () => {
  it("starts collapsed and reuses one panel for the last selected queue", () => {
    render(<AdminActionQueue items={buildAdminActionQueueItems({...EMPTY_COUNTS, openMonitoringIssues:40})} />);
    const buttons=screen.getAllByRole("button");
    expect(buttons).toHaveLength(5);
    const panel=document.getElementById(buttons[0].getAttribute("aria-controls")!);
    expect(panel?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("link", {name:"Open listings queue"})).toBeNull();
    fireEvent.click(buttons[0]);
    expect(panel?.getAttribute("aria-hidden")).toBe("false");
    expect(screen.getByRole("link", {name:"Open listings queue"}).getAttribute("href")).toBe(EXPECTED_HREFS[0]);
    fireEvent.click(buttons[4]);
    expect(document.getElementById(buttons[4].getAttribute("aria-controls")!)).toBe(panel);
    expect(screen.queryByRole("link", {name:"Open listings queue"})).toBeNull();
    expect(screen.getByRole("link", {name:"Open issues queue"}).getAttribute("href")).toBe(EXPECTED_HREFS[4]);
    expect(buttons[0].getAttribute("aria-pressed")).toBe("false");
    expect(buttons[4].getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(buttons[4]);
    expect(panel?.getAttribute("aria-hidden")).toBe("false");
  });
});

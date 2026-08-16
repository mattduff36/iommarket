import { render, screen } from "@testing-library/react";
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

describe("buildAdminActionQueueItems", () => {
  it("returns the five work queues in dashboard order with the expected hrefs", () => {
    const items = buildAdminActionQueueItems(EMPTY_COUNTS);

    expect(items.map((item) => item.label)).toEqual(EXPECTED_LABELS);
    expect(items.map((item) => item.href)).toEqual(EXPECTED_HREFS);
  });
});

describe("AdminActionQueue", () => {
  it("always renders every queue card when counts are zero", () => {
    render(<AdminActionQueue items={buildAdminActionQueueItems(EMPTY_COUNTS)} />);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(5);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(EXPECTED_HREFS);

    for (const label of EXPECTED_LABELS) {
      expect(screen.getByText(new RegExp(`0 ${label}`))).toBeTruthy();
    }
  });

  it("emphasizes cards when the count is greater than zero", () => {
    render(
      <AdminActionQueue
        items={buildAdminActionQueueItems({
          ...EMPTY_COUNTS,
          openReports: 3,
        })}
      />,
    );

    const reportsLink = screen.getByRole("link", { name: /3 Open reports/i });
    const listingsLink = screen.getByRole("link", {
      name: /0 Listings awaiting review/i,
    });

    expect(reportsLink.className).toContain("border-neon-red-500/20");
    expect(listingsLink.className).not.toContain("border-neon-red-500/20");
  });
});

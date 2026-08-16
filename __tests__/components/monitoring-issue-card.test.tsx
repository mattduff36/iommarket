import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  MonitoringIssueCard,
  type MonitoringIssueCardData,
} from "@/components/admin/monitoring-issue-card";

const issue: MonitoringIssueCardData = {
  id: "issue-123",
  fingerprint: "abc123",
  title: "Search request failed",
  status: "RESOLVED",
  severity: "HIGH",
  source: "CLIENT",
  firstSeenAt: new Date("2026-08-14T10:00:00.000Z"),
  lastSeenAt: new Date("2026-08-15T11:30:00.000Z"),
  occurrences: 3,
  sampleMessage: "The search request could not load another page of listings.",
  sampleRoute: "/search",
  sampleAction: "loadMore",
  sampleComponent: "ListingResultsClient",
  mutedUntil: null,
  resolvedAt: new Date("2026-08-16T21:40:00.000Z"),
  lastAlertedAt: null,
  lastPromptGeneratedAt: null,
  createdAt: new Date("2026-08-14T10:00:00.000Z"),
  updatedAt: new Date("2026-08-16T21:40:00.000Z"),
  _count: { events: 2 },
  statusEvents: [
    {
      toStatus: "RESOLVED",
      notes: "Historical issue resolved after subsequent development.",
      createdAt: new Date("2026-08-16T21:40:00.000Z"),
    },
  ],
};

describe("MonitoringIssueCard", () => {
  afterEach(cleanup);

  it("expands to show issue context, timeline, and latest status note", () => {
    const { container } = render(<MonitoringIssueCard issue={issue} />);
    const details = container.querySelector("details");
    const summary = container.querySelector("summary");

    expect(details).toBeTruthy();
    expect(summary).toBeTruthy();
    expect(screen.getByText("Search request failed")).toBeTruthy();
    expect(screen.getByText("3 occurrences")).toBeTruthy();

    fireEvent.click(summary!);

    expect(details?.open).toBe(true);
    expect(screen.getByText("/search")).toBeTruthy();
    expect(screen.getByText("ListingResultsClient")).toBeTruthy();
    expect(
      screen.getByText("Historical issue resolved after subsequent development."),
    ).toBeTruthy();
    expect(
      container.querySelectorAll('time[datetime="2026-08-16T21:40:00.000Z"]').length,
    ).toBeGreaterThan(0);
  });
});

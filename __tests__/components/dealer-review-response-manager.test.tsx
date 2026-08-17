import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { saveDraftMock } = vi.hoisted(() => ({ saveDraftMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/actions/dealer-reviews", () => ({
  saveDealerReviewResponseDraft: saveDraftMock,
  submitDealerReviewResponse: vi.fn(),
  openDealerReviewDispute: vi.fn(),
}));

import { DealerReviewResponseManager } from "@/app/(public)/dealer/dashboard/dealer-review-response-manager";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DealerReviewResponseManager MD-REV-002", () => {
  it("keeps the approved response visible while an edit is pending", () => {
    render(
      <DealerReviewResponseManager
        reviews={[
          {
            id: "review-1",
            rating: 5,
            comment: "A thoughtful customer review",
            canRespond: true,
            createdAt: "2026-08-16T00:00:00.000Z",
            approvedResponse: {
              body: "Current approved response",
              version: 3,
            },
            activeRevision: {
              id: "revision-2",
              body: "Pending replacement response",
              status: "PENDING",
              version: 1,
            },
            lastDecision: {
              status: "APPROVED",
              body: "Current approved response",
              reason: null,
            },
            latestDispute: null,
          },
        ]}
      />,
    );

    expect(screen.getByText("Current approved response")).toBeTruthy();
    expect(
      (
        screen.getByDisplayValue(
          "Pending replacement response",
        ) as HTMLTextAreaElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText(/approved response above remains public/i)).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Submit for review",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("explains that responses and disputes do not change ratings", () => {
    render(<DealerReviewResponseManager reviews={[]} />);
    expect(screen.getByText(/never change the rating/i)).toBeTruthy();
  });

  it("allows an approved rating-only review to reach the dispute flow MD-REV-001", () => {
    render(
      <DealerReviewResponseManager
        reviews={[
          {
            id: "review-rating-only",
            rating: 2,
            comment: null,
            canRespond: false,
            createdAt: "2026-08-16T00:00:00.000Z",
            approvedResponse: null,
            activeRevision: null,
            lastDecision: null,
            latestDispute: null,
          },
        ]}
      />,
    );
    expect(screen.queryByLabelText("Dealer response")).toBeNull();
    expect(screen.getByText(/still dispute this approved rating/i)).toBeTruthy();
    expect(screen.getByText("Dispute this review")).toBeTruthy();
  });

  it("loads the winning draft and never claims the unsaved body was saved", async () => {
    saveDraftMock.mockResolvedValue({
      data: {
        id: "revision-winner",
        body: "Draft saved by another request",
        status: "DRAFT",
        version: 2,
      },
      conflict: true,
    });
    render(
      <DealerReviewResponseManager
        reviews={[
          {
            id: "review-1",
            rating: 5,
            comment: "Helpful review",
            canRespond: true,
            createdAt: "2026-08-16T00:00:00.000Z",
            approvedResponse: null,
            activeRevision: null,
            lastDecision: null,
            latestDispute: null,
          },
        ]}
      />,
    );

    fireEvent.change(screen.getByLabelText("Dealer response"), {
      target: { value: "My unsaved body" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "Another save completed first. The latest draft has been loaded.",
        ),
      ).toBeTruthy(),
    );
    expect(
      (screen.getByLabelText("Dealer response") as HTMLTextAreaElement).value,
    ).toBe("Draft saved by another request");
    expect(screen.queryByText("Draft saved.")).toBeNull();
  });
});

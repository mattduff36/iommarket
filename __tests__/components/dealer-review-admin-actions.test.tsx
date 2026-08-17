import * as React from "react";
import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

const { moderateResponseMock, decideDisputeMock, moderateReviewMock, refreshMock } =
  vi.hoisted(() => ({
    moderateResponseMock: vi.fn(),
    decideDisputeMock: vi.fn(),
    moderateReviewMock: vi.fn(),
    refreshMock: vi.fn(),
  }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
}));
vi.mock("@/actions/dealer-reviews", () => ({
  moderateDealerReviewResponse: moderateResponseMock,
  decideDealerReviewDispute: decideDisputeMock,
  moderateDealerReview: moderateReviewMock,
}));

import { ReviewActions } from "@/app/(admin)/admin/reviews/review-actions";
import {
  ResponseRevisionActions,
  ReviewDisputeActions,
} from "@/app/(admin)/admin/reviews/response-dispute-actions";

function render(ui: React.ReactElement) {
  return rtlRender(
    <AppRouterContext.Provider
      value={{
        push: vi.fn(),
        replace: vi.fn(),
        refresh: refreshMock,
        prefetch: vi.fn(),
        back: vi.fn(),
        forward: vi.fn(),
        bfcacheId: "test",
      }}
    >
      {ui}
    </AppRouterContext.Provider>,
  );
}

afterEach(cleanup);

describe("dealer review admin decisions MD-REV-001", () => {
  it("submits response moderation with both CAS versions", async () => {
    moderateResponseMock.mockResolvedValue({ data: { id: "revision-1" } });
    render(
      <ResponseRevisionActions
        revisionId="revision-1"
        revisionVersion={2}
        responseVersion={4}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve response" }));

    await waitFor(() => {
      expect(moderateResponseMock).toHaveBeenCalledWith({
        revisionId: "revision-1",
        expectedVersion: 2,
        expectedResponseVersion: 4,
        decision: "APPROVED",
        reasonCode: undefined,
        adminNotes: undefined,
      });
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("AUD-REVIEW-001a refreshes review actions after a successful save", async () => {
    moderateReviewMock.mockResolvedValue({ data: { id: "rev-1" } });
    render(
      <ReviewActions
        reviewId="rev-1"
        currentVersion={2}
        currentStatus="PENDING"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(moderateReviewMock).toHaveBeenCalledWith({
        reviewId: "rev-1",
        expectedVersion: 2,
        status: "PENDING",
        reasonCode: undefined,
        adminNotes: undefined,
      });
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("submits a versioned dispute decision", async () => {
    decideDisputeMock.mockResolvedValue({ data: { id: "dispute-1" } });
    render(<ReviewDisputeActions disputeId="dispute-1" version={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Reject dispute" }));

    await waitFor(() => {
      expect(decideDisputeMock).toHaveBeenCalledWith({
        disputeId: "dispute-1",
        expectedVersion: 3,
        decision: "REJECTED",
        reasonCode: "POLICY",
        adminNotes: undefined,
      });
    });
  });
});

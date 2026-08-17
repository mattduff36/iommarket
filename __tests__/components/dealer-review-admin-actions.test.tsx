import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { moderateResponseMock, decideDisputeMock, refreshMock } = vi.hoisted(() => ({
  moderateResponseMock: vi.fn(),
  decideDisputeMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));
vi.mock("@/actions/dealer-reviews", () => ({
  moderateDealerReviewResponse: moderateResponseMock,
  decideDealerReviewDispute: decideDisputeMock,
}));

import {
  ResponseRevisionActions,
  ReviewDisputeActions,
} from "@/app/(admin)/admin/reviews/response-dispute-actions";

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

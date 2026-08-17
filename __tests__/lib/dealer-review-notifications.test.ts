import { describe, expect, it } from "vitest";
import {
  buildDealerReviewAdminEmail,
  buildDealerReviewDecisionEmail,
} from "@/lib/email/dealer-review-notifications";

describe("dealer review notification privacy MD-REV-001", () => {
  it("sends admins references and links without dealer-authored UGC", () => {
    const email = buildDealerReviewAdminEmail({
      kind: "DISPUTE_OPENED",
      dealerName: "Manx Motors",
      entityId: "dispute-1",
    });
    expect(email.text).toContain("Reference: dispute-1");
    expect(email.text).toContain("/admin/reviews");
    expect(email.text).not.toContain("evidence");
    expect(email.text).not.toContain("dispute body");
  });

  it("notifies dealers with status and reason but no private admin notes", () => {
    const email = buildDealerReviewDecisionEmail({
      kind: "RESPONSE_DECIDED",
      dealerName: "Dealer <script>",
      status: "REJECTED",
      reasonCode: "POLICY",
    });
    expect(email.text).toContain("Status: REJECTED");
    expect(email.text).toContain("Reason: POLICY");
    expect(email.html).toContain("Dealer &lt;script&gt;");
    expect(email.html).not.toContain("Dealer <script>");
  });
});

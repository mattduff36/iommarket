import { describe, expect, it } from "vitest";
import {
  auditRecordHref,
  dealerAdminHref,
  listingReviewHref,
  userAdminHref,
} from "@/lib/admin/record-href";

describe("admin record hrefs", () => {
  it("builds listing, dealer, and user destinations", () => {
    expect(listingReviewHref("listing-1")).toBe("/listings/listing-1?adminReview=1");
    expect(dealerAdminHref("dealer-1")).toBe("/admin/dealers?id=dealer-1");
    expect(userAdminHref("user-1")).toBe("/admin/users/user-1");
  });

  it("maps audit entity types that already have a page", () => {
    expect(auditRecordHref("User", "user-1")).toBe("/admin/users/user-1");
    expect(auditRecordHref("Listing", "listing-1")).toBe(
      "/listings/listing-1?adminReview=1",
    );
    expect(auditRecordHref("DealerProfile", "dealer-1")).toBe(
      "/admin/dealers?id=dealer-1",
    );
    expect(auditRecordHref("MonitoringIssue", "issue-1")).toBe(
      "/admin/monitoring/issue-1",
    );
    expect(auditRecordHref("ContentPage", "page-1")).toBe("/admin/pages/page-1");
    expect(auditRecordHref("InvoiceRequest", "invoice-1")).toBe(
      "/admin/costs/confirm/invoice-1",
    );
  });

  it("returns null when the audit record has no page", () => {
    expect(auditRecordHref("Payment", "pay-1")).toBeNull();
    expect(auditRecordHref("Subscription", "sub-1")).toBeNull();
    expect(auditRecordHref("Report", "report-1")).toBeNull();
    expect(auditRecordHref("Unknown", "id-1")).toBeNull();
    expect(auditRecordHref("User", "")).toBeNull();
  });
});

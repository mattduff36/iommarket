import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "prisma/migrations/20260817040000_dealer_review_responses/migration.sql",
  ),
  "utf8",
);

describe("dealer review response migration MD-REV-001 MD-REV-004", () => {
  it("is additive and enforces one response and one open revision", () => {
    expect(migration).toContain('CREATE TABLE "DealerReviewResponse"');
    expect(migration).toContain('CREATE TABLE "DealerReviewResponseRevision"');
    expect(migration).toContain('CREATE TABLE "DealerReviewDispute"');
    expect(migration).toContain(
      'CREATE TABLE "DealerReviewResponseModerationEvent"',
    );
    expect(migration).toContain('CREATE TABLE "DealerReviewDisputeEvent"');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "DealerReviewResponse_reviewId_key"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "DealerReviewResponseRevision_open_responseId_key"',
    );
    expect(migration).toContain("WHERE \"status\" IN ('DRAFT', 'PENDING')");
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "DealerReviewDispute_open_reviewId_key"',
    );
    expect(migration).toMatch(
      /ALTER TABLE "DealerReviewModerationEvent"[\s\S]*ADD COLUMN "reviewVersion" INTEGER NOT NULL DEFAULT 0/,
    );
    expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE)\b/i);
    expect(migration).not.toMatch(/\bUPDATE\s+"DealerReview"/i);
  });

  it("cascades retention deletion without orphaning private UGC", () => {
    expect(migration).toMatch(
      /DealerReviewResponse_reviewId_fkey[\s\S]*REFERENCES "DealerReview"\("id"\)[\s\S]*ON DELETE CASCADE/,
    );
    expect(migration).toMatch(
      /DealerReviewResponseRevision_responseId_fkey[\s\S]*REFERENCES "DealerReviewResponse"\("id"\)[\s\S]*ON DELETE CASCADE/,
    );
    expect(migration).toMatch(
      /DealerReviewResponseModerationEvent_revisionId_fkey[\s\S]*REFERENCES "DealerReviewResponseRevision"\("id"\)[\s\S]*ON DELETE CASCADE/,
    );
    expect(migration).toMatch(
      /DealerReviewDispute_reviewId_fkey[\s\S]*REFERENCES "DealerReview"\("id"\)[\s\S]*ON DELETE CASCADE/,
    );
    expect(migration).toMatch(
      /DealerReviewDisputeEvent_disputeId_fkey[\s\S]*REFERENCES "DealerReviewDispute"\("id"\)[\s\S]*ON DELETE CASCADE/,
    );
  });

  it("enforces approved revision ownership and approved status in the database", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "DealerReviewResponseRevision_id_responseId_key"',
    );
    expect(migration).toMatch(
      /DealerReviewResponse_approvedRevisionId_id_fkey[\s\S]*FOREIGN KEY \("approvedRevisionId", "id"\)[\s\S]*REFERENCES "DealerReviewResponseRevision"\("id", "responseId"\)/,
    );
    expect(migration).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(migration).toContain(
      'CREATE FUNCTION "check_dealer_review_response_approved_revision"()',
    );
    expect(migration).toContain(
      'CREATE CONSTRAINT TRIGGER "DealerReviewResponse_approved_revision_check"',
    );
    expect(migration).toMatch(/revision\.status <> 'APPROVED'/);
  });

  it("validates only the affected response at deferred commit time", () => {
    expect(migration).toContain("affected_response_id TEXT");
    expect(migration).toContain(
      "IF TG_TABLE_NAME = 'DealerReviewResponse' THEN",
    );
    expect(migration).toContain(
      "ELSIF TG_TABLE_NAME = 'DealerReviewResponseRevision' THEN",
    );
    expect(migration).toContain("IF TG_OP = 'DELETE' THEN");
    expect(migration).toContain("affected_response_id := OLD.id");
    expect(migration).toContain('affected_response_id := OLD."responseId"');
    expect(migration).toContain("affected_response_id := NEW.id");
    expect(migration).toContain('affected_response_id := NEW."responseId"');
    expect(migration).not.toContain("COALESCE(NEW.");
    expect(migration).toContain(
      "WHERE response.id = affected_response_id",
    );
    expect(migration).not.toContain(
      'WHERE response."approvedRevisionId" IS NOT NULL',
    );
    expect(migration).toMatch(
      /DealerReviewResponse_approved_revision_check[\s\S]*WHEN \(NEW\."approvedRevisionId" IS NOT NULL\)[\s\S]*EXECUTE FUNCTION/,
    );
    expect(migration).toMatch(
      /DealerReviewResponseRevision_approved_reference_check[\s\S]*AFTER INSERT OR UPDATE OR DELETE[\s\S]*DEFERRABLE INITIALLY DEFERRED/,
    );
  });

  it("allows automatic rejection of an unsubmitted draft", () => {
    expect(migration).toMatch(
      /"status" = 'REJECTED'\s+AND "decidedAt" IS NOT NULL/,
    );
    expect(migration).not.toMatch(
      /"status" = 'REJECTED'\s+AND "submittedAt" IS NOT NULL/,
    );
  });

  it("keeps response drafts, events, and disputes out of PostgREST", () => {
    for (const table of [
      "DealerReviewResponse",
      "DealerReviewResponseRevision",
      "DealerReviewResponseModerationEvent",
      "DealerReviewDispute",
      "DealerReviewDisputeEvent",
    ]) {
      expect(migration).toContain(
        `ALTER TABLE "public"."${table}" ENABLE ROW LEVEL SECURITY`,
      );
    }
  });
});

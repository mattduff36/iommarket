import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "prisma/migrations/20260815140000_listing_revisions_and_notifications/migration.sql",
  ),
  "utf8",
);

describe("listing revision migration ALR-MIG-001 ALR-SCHEMA-001", () => {
  it("adds revision tables and a partial unique index for one open revision", () => {
    expect(migration).toContain('CREATE TYPE "ListingRevisionStatus"');
    expect(migration).toContain("SUBMIT_REVISION");
    expect(migration).toContain("APPROVE_REVISION");
    expect(migration).toContain("REJECT_REVISION");
    expect(migration).toContain("CREATE TABLE \"ListingRevision\"");
    expect(migration).toContain("CREATE TABLE \"ListingRevisionImage\"");
    expect(migration).toContain('CREATE UNIQUE INDEX "ListingRevision_open_listingId_key"');
    expect(migration).toContain("WHERE \"status\" IN ('DRAFT', 'PENDING')");
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ListingRevisionImage_revisionId_provider_publicId_key"',
    );
    expect(migration).not.toContain(
      'CREATE UNIQUE INDEX "ListingRevisionImage_provider_publicId_key"',
    );
  });
});

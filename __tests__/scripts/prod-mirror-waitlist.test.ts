import { describe, expect, it } from "vitest";
import {
  assertProductionWaitlistCopied,
  mergeWaitlistRows,
  type WaitlistSnapshotRow,
} from "../../scripts/prod-mirror/waitlist";

function row(partial: Partial<WaitlistSnapshotRow> & Pick<WaitlistSnapshotRow, "id" | "email">): WaitlistSnapshotRow {
  return {
    interests: ["BUYING_CARS"],
    source: "coming_soon_page",
    deletedAt: null,
    deletedByAdminId: null,
    deletionReason: null,
    marketingConsentAt: "2026-01-01T00:00:00.000Z",
    marketingPolicyVersion: "1.0",
    marketingWithdrawnAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...partial,
  };
}

describe("PMR-WAIT-001 full production waitlist copy including soft-deleted rows", () => {
  it("inserts production emails that are missing on preview, including deleted rows", () => {
    const preview = [row({ id: "p1", email: "keep@example.com" })];
    const production = [
      row({ id: "p1-prod", email: "keep@example.com" }),
      row({
        id: "prod-live",
        email: "new@example.com",
        createdAt: "2026-08-01T00:00:00.000Z",
      }),
      row({
        id: "prod-deleted",
        email: "gone@example.com",
        deletedAt: "2026-08-10T00:00:00.000Z",
        deletedByAdminId: "admin-1",
        deletionReason: "request",
      }),
    ];
    const merged = mergeWaitlistRows(preview, production);
    expect(merged.inserts.map((item) => item.email).sort()).toEqual([
      "gone@example.com",
      "new@example.com",
    ]);
    expect(merged.inserts.find((item) => item.email === "gone@example.com")?.deletedAt).toBe(
      "2026-08-10T00:00:00.000Z",
    );
    assertProductionWaitlistCopied(production, merged.result);
  });
});

describe("PMR-WAIT-002 production waitlist rows win email conflicts", () => {
  it("keeps the preview id but copies production timestamps, consent, and deletion fields", () => {
    const preview = [
      row({
        id: "preview-1",
        email: "same@example.com",
        createdAt: "2025-01-01T00:00:00.000Z",
        marketingConsentAt: "2025-01-01T00:00:00.000Z",
        marketingPolicyVersion: "0.9",
        marketingWithdrawnAt: "2025-06-01T00:00:00.000Z",
        deletedAt: null,
      }),
    ];
    const production = [
      row({
        id: "prod-1",
        email: "same@example.com",
        createdAt: "2026-03-01T00:00:00.000Z",
        marketingConsentAt: "2026-03-01T00:00:00.000Z",
        marketingPolicyVersion: "1.2",
        marketingWithdrawnAt: null,
        deletedAt: "2026-08-20T00:00:00.000Z",
        deletedByAdminId: "admin-2",
        deletionReason: "soft-delete",
        interests: ["DEALER"],
      }),
    ];
    const merged = mergeWaitlistRows(preview, production);
    expect(merged.inserts).toEqual([]);
    expect(merged.updates).toHaveLength(1);
    expect(merged.updates[0]?.previewId).toBe("preview-1");
    expect(merged.updates[0]?.row).toMatchObject({
      id: "preview-1",
      email: "same@example.com",
      createdAt: "2026-03-01T00:00:00.000Z",
      deletedAt: "2026-08-20T00:00:00.000Z",
      deletedByAdminId: "admin-2",
      deletionReason: "soft-delete",
      marketingConsentAt: "2026-03-01T00:00:00.000Z",
      marketingPolicyVersion: "1.2",
      marketingWithdrawnAt: null,
      interests: ["DEALER"],
    });
    const second = mergeWaitlistRows(merged.result, production);
    expect(second.inserts).toEqual([]);
    expect(second.updates).toEqual([]);
    expect(second.result).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import { toCostLineDto, toInvoiceRequestDto } from "@/lib/costs/dto";
import { safeInvoiceAuditDetails } from "@/lib/costs/invoices";
import { hasSensitiveCostField } from "@/lib/costs/privacy";

describe("COST-PRIVACY-001 client-visible cost payloads", () => {
  it("omits native amounts, FX rates, and markup fields", () => {
    const line = toCostLineDto({
      id: "entry_1",
      category: "CURSOR",
      displayLabel: "Cursor usage",
      markedGbpMinor: 1200n,
      invoiceability: "INVOICEABLE",
      servicePeriodStart: new Date("2026-09-01T00:00:00.000Z"),
      servicePeriodEnd: new Date("2026-09-02T00:00:00.000Z"),
    });
    const request = toInvoiceRequestDto({
      id: "req_1",
      status: "PENDING",
      frozenGbpMinor: 1200n,
      frozenEntryCount: 1,
      createdAt: new Date("2026-09-03T00:00:00.000Z"),
      confirmedAt: null,
      emailStatus: "PENDING",
      outboxId: "outbox_1",
    });
    const audit = safeInvoiceAuditDetails({ requestId: "req_1", status: "PENDING" });

    expect(hasSensitiveCostField(line)).toBe(false);
    expect(hasSensitiveCostField(request)).toBe(false);
    expect(hasSensitiveCostField(audit)).toBe(false);
    expect(JSON.stringify(line)).not.toMatch(/native|fx|markup|0\.2|20%/i);
    expect(line.amountLabel).toBe("£12.00");
  });
});

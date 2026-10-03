/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { buildCursorAudit } from "@/lib/costs/cursor-audit";
import { cursorAuditForViewer } from "@/lib/costs/dto";

const id = (n: string) => n.padStart(64, "0");

function event(overrides: Record<string, unknown> = {}) {
  return {
    identity: id("1"),
    occurredAt: "2026-10-02T14:00:00.000Z",
    model: "gpt-5.6-sol",
    funding: "included",
    projectId: "itrader",
    attributionStatus: "assigned",
    nominalUsd: "1.00000000",
    reportedOnDemandUsd: "0",
    clientUsd: "0.60000000",
    unresolved: false,
    free: false,
    identityAmbiguous: false,
    sourceQuality: "complete",
    displayStatus: "matched",
    rateCardStatus: "matched",
    conversationId: "must-not-escape",
    ...overrides,
  };
}

function source(events: unknown[], eventIds: string[]) {
  return { metadata: { records: events, eventIds, providerAccountRef: "must-not-escape" } };
}

describe("buildCursorAudit", () => {
  it("keeps provider financial audit data out of non-owner dashboard payloads", () => {
    const audit = buildCursorAudit([source([event()], [id("1")])]);
    expect(cursorAuditForViewer(audit, false)).toBeUndefined();
    expect(cursorAuditForViewer(audit, true)).toBe(audit);
  });

  it("aggregates by UTC day, model, and funding while keeping reported values in USD", () => {
    const included = event();
    const estimated = event({
      identity: id("2"),
      model: "composer-2.5",
      nominalUsd: "0.25000000",
      rateCardStatus: "calculated",
      clientUsd: "0.15000000",
    });
    const onDemand = event({
      identity: id("3"),
      model: "composer-2.5",
      funding: "on-demand",
      nominalUsd: null,
      rateCardStatus: "calculated",
      reportedOnDemandUsd: "2.25000000",
      clientUsd: "2.47500000",
    });
    const result = buildCursorAudit([
      source([included, estimated, onDemand], [id("1"), id("2"), id("3")]),
    ]);

    expect(result.status).toBe("available");
    expect(result.currency).toBe("USD");
    expect(result.rows).toEqual([
      expect.objectContaining({
        day: "2026-10-02",
        model: "composer-2.5",
        funding: "included",
        nominalUsd: "0.25000000",
        nominalBasis: "rate-card-estimate",
        providerChargeUsd: "0",
        clientUsd: "0.15000000",
      }),
      expect.objectContaining({
        day: "2026-10-02",
        model: "composer-2.5",
        funding: "on-demand",
        eventCount: 1,
        nominalUsd: "0",
        nominalBasis: "unavailable",
        nominalMissingEvents: 1,
        providerChargeUsd: "2.25000000",
        clientUsd: "2.47500000",
      }),
      expect.objectContaining({
        day: "2026-10-02",
        model: "gpt-5.6-sol",
        funding: "included",
        nominalUsd: "1.00000000",
        nominalBasis: "provider-reported",
        providerChargeUsd: "0",
        clientUsd: "0.60000000",
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("must-not-escape");
    expect(JSON.stringify(result)).not.toContain(id("1"));
  });

  it("omits ineligible events and marks an unresolved reference partial", () => {
    const assigned = event();
    const otherProject = event({ identity: id("2"), projectId: "other" });
    const unresolved = event({ identity: id("3"), unresolved: true });
    const result = buildCursorAudit([
      source([assigned, otherProject, unresolved], [id("1"), id("2"), id("3"), id("4")]),
    ]);

    expect(result.status).toBe("partial");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.clientUsd).toBe("0.60000000");
    expect(result.reason).toMatch(/could not be reconciled/);
  });

  it("does not double count repeated event identities across source lines", () => {
    const usage = event();
    const result = buildCursorAudit([
      source([usage], [id("1")]),
      source([usage], [id("1")]),
    ]);

    expect(result.status).toBe("partial");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.eventCount).toBe(1);
  });

  it("omits identities with conflicting records inside or across source snapshots", () => {
    const original = event();
    const conflict = event({ model: "composer-2.5", clientUsd: "9.00000000" });
    const withinSnapshot = buildCursorAudit([
      source([original, conflict], [id("1")]),
    ]);
    expect(withinSnapshot.status).toBe("partial");
    expect(withinSnapshot.rows).toHaveLength(0);

    const acrossSnapshots = buildCursorAudit([
      source([original], [id("1")]),
      source([conflict], [id("1")]),
    ]);
    expect(acrossSnapshots.status).toBe("partial");
    expect(acrossSnapshots.rows).toHaveLength(0);
  });

  it("deduplicates identical records and groups by the UTC day", () => {
    const usage = event({ occurredAt: "2026-10-02T23:30:00-02:00" });
    const result = buildCursorAudit([
      source([usage, { ...usage }], [id("1")]),
    ]);
    expect(result.status).toBe("available");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ day: "2026-10-03", eventCount: 1 });
  });

  it("counts rate-card basis only for events with a saved nominal amount", () => {
    const result = buildCursorAudit([
      source([
        event({ rateCardStatus: "calculated", nominalUsd: null }),
        event({ identity: id("2"), rateCardStatus: "calculated", nominalUsd: null }),
        event({ identity: id("3"), nominalUsd: "3.00000000", rateCardStatus: "matched" }),
      ], [id("1"), id("2"), id("3")]),
    ]);
    expect(result.rows[0]).toMatchObject({
      nominalBasis: "mixed",
      nominalMissingEvents: 2,
      nominalUsd: "3.00000000",
    });
  });

  it("reports unavailable when active source metadata has no verifiable breakdown", () => {
    expect(buildCursorAudit([{ metadata: { includedNominalUsd: "4" } }])).toMatchObject({
      status: "unavailable",
      currency: "USD",
      rows: [],
    });
  });
});

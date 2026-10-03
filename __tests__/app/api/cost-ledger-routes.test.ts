/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  assertCanonicalLedgerWriter,
  createInvoiceRequest,
  getCostDashboard,
  ingestCursorBatch,
  userFindUnique,
  workflowCreate,
} = vi.hoisted(() => ({
  assertCanonicalLedgerWriter: vi.fn(),
  createInvoiceRequest: vi.fn(),
  getCostDashboard: vi.fn(),
  ingestCursorBatch: vi.fn(),
  userFindUnique: vi.fn(),
  workflowCreate: vi.fn(),
}));

vi.mock("@/lib/costs/ledger-role", () => ({
  assertCanonicalLedgerWriter,
}));

vi.mock("@/lib/costs/queries", () => ({
  getCostDashboard,
}));

vi.mock("@/lib/costs/cursor-ingest", () => ({
  ingestCursorBatch,
  CursorIngestConflictError: class CursorIngestConflictError extends Error {},
}));

vi.mock("@/lib/costs/invoices", () => ({
  createInvoiceRequest,
  CostInvoiceError: class CostInvoiceError extends Error {},
}));

vi.mock("@/lib/costs/db", () => ({
  costDb: {
    user: { findUnique: userFindUnique },
    costWorkflowEvent: { create: workflowCreate },
  },
}));

const originalEnv = {
  enabled: process.env.COSTS_ENABLED,
  read: process.env.COST_LEDGER_READ_SECRET,
  ingest: process.env.COST_LEDGER_INGEST_SECRET,
  request: process.env.COST_LEDGER_REQUEST_SECRET,
  owner: process.env.COST_OWNER_AUTH_USER_ID,
};

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("canonical cost ledger API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COSTS_ENABLED = "true";
    process.env.COST_LEDGER_READ_SECRET = "read-secret";
    process.env.COST_LEDGER_INGEST_SECRET = "ingest-secret";
    process.env.COST_LEDGER_REQUEST_SECRET = "request-secret";
    process.env.COST_OWNER_AUTH_USER_ID = "owner-auth";
  });

  afterEach(() => {
    restore("COSTS_ENABLED", originalEnv.enabled);
    restore("COST_LEDGER_READ_SECRET", originalEnv.read);
    restore("COST_LEDGER_INGEST_SECRET", originalEnv.ingest);
    restore("COST_LEDGER_REQUEST_SECRET", originalEnv.request);
    restore("COST_OWNER_AUTH_USER_ID", originalEnv.owner);
  });

  it("requires a scoped read secret and returns the canonical dashboard", async () => {
    getCostDashboard.mockResolvedValue({
      enabled: true,
      ledgerRevision: "revision-1",
    });
    const { GET } = await import("@/app/api/internal/cost-ledger/route");

    const denied = await GET(
      new NextRequest("https://itrader.im/api/internal/cost-ledger"),
    );
    expect(denied.status).toBe(401);

    const response = await GET(
      new NextRequest("https://itrader.im/api/internal/cost-ledger", {
        headers: { authorization: "Bearer read-secret" },
      }),
    );
    expect(response.status).toBe(200);
    expect(assertCanonicalLedgerWriter).toHaveBeenCalled();
    expect(getCostDashboard).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, isOwner: true }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        enabled: true,
        ledgerRevision: "revision-1",
        affectsLiveLedger: true,
      },
    });
  });

  it("validates the ingestion contract and forwards a stable idempotency key", async () => {
    ingestCursorBatch.mockResolvedValue({
      status: "succeeded",
      runId: "run-1",
      classifiedCount: 1,
      unresolvedCount: 0,
      eventStore: "table",
    });
    const { POST } = await import("@/app/api/internal/cost-ledger/events/route");
    const event = {
      timestamp: "2026-09-26T18:36:34.992Z",
      model: "grok-4.7-high",
      kind: "USAGE_EVENT_KIND_INCLUDED_IN_ULTRA",
      conversationId: "conversation-1",
      isTokenBasedCall: true,
      chargedCents: 16.136999130249023,
      tokenUsage: {
        inputTokens: 36427,
        outputTokens: 918,
        cacheReadTokens: 166016,
        cacheWriteTokens: 0,
        totalCents: 16.136999130249023,
      },
      attribution: { projectId: "itrader", status: "assigned" },
    };
    const response = await POST(
      new NextRequest("https://itrader.im/api/internal/cost-ledger/events", {
        method: "POST",
        headers: {
          authorization: "Bearer ingest-secret",
          "content-type": "application/json",
          "idempotency-key": "collect-stable-1",
        },
        body: JSON.stringify({
          contractVersion: "cost-ledger-v1",
          projectId: "itrader",
          providerAccountRef: "account-ref-1",
          sourceQuality: "complete",
          events: [event],
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(ingestCursorBatch).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "collect-stable-1" }),
    );
  });

  it("keeps concurrent uploads pending while the owning batch is processing", async () => {
    ingestCursorBatch.mockResolvedValue({
      status: "processing",
      runId: "run-active",
      classifiedCount: 0,
      unresolvedCount: 0,
      eventStore: "table",
    });
    const { POST } = await import("@/app/api/internal/cost-ledger/events/route");
    const response = await POST(
      new NextRequest("https://itrader.im/api/internal/cost-ledger/events", {
        method: "POST",
        headers: {
          authorization: "Bearer ingest-secret",
          "content-type": "application/json",
          "idempotency-key": "collect-concurrent-1",
        },
        body: JSON.stringify({
          contractVersion: "cost-ledger-v1",
          projectId: "itrader",
          providerAccountRef: "account-ref-1",
          sourceQuality: "complete",
          events: [],
        }),
      }),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "processing" },
    });
  });

  it("maps preview requests to the canonical owner instead of trusting an actor id", async () => {
    userFindUnique.mockResolvedValue({ id: "owner-user" });
    createInvoiceRequest.mockResolvedValue({
      request: { id: "request-1" },
      outboxId: "outbox-1",
    });
    const { POST } = await import("@/app/api/internal/cost-ledger/requests/route");
    const response = await POST(
      new NextRequest("https://itrader.im/api/internal/cost-ledger/requests", {
        method: "POST",
        headers: {
          authorization: "Bearer request-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ actorId: "untrusted-caller" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(userFindUnique).toHaveBeenCalledWith({
      where: { authUserId: "owner-auth" },
      select: { id: true },
    });
    expect(createInvoiceRequest).toHaveBeenCalledWith({
      requesterUserId: "owner-user",
    });
    expect(workflowCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "owner-user",
        payload: { origin: "preview" },
      }),
    });
  });
});

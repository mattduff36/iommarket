import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fingerprintSnapshot, type FingerprintSnapshot } from "@/lib/dealer-stock-sync/fingerprint";
import type { ApplyAttempt } from "@/lib/dealer-stock-sync/apply-recovery";
import type { CreatePlanAction } from "@/lib/dealer-stock-sync/types";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), snapshot: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction, dealerStockSyncJob: { findMany: mocks.findMany } } }));
vi.mock("@/lib/dealer-stock-sync/snapshot", () => ({ loadStockSyncSnapshot: mocks.snapshot }));
import { decorateStockApplyRecovery, recoverApprovedStock } from "@/lib/dealer-stock-sync/apply-recovery-store";

const conflict = () => new Prisma.PrismaClientKnownRequestError("serialization conflict", { code: "P2034", clientVersion: "test" });
type Job = ApplyAttempt & { idempotencyKey: string; createdById?: string };
type JobWhere = { bindingId?: string; reportId?: string; kind?: string; idempotencyKey?: string; status?: { in: string[] } };

// Contract harness: committed state is isolated from transaction drafts. Concurrent
// commits produce a Prisma serialization conflict; this is not a live PostgreSQL test.
function fixture(commitConflict: () => Error = conflict) {
  const actions: CreatePlanAction[] = [{
    kind: "create", sourceIdentityKey: "new-car", listingId: null, title: "Ford Fiesta",
    description: "Approved stock", pricePence: 500000, categorySlug: "car",
    attributes: {}, ownedImages: [], changes: [], sourceImageUrls: ["https://images.example.test/car.jpg"],
  }];
  const snapshot: FingerprintSnapshot = {
    dealer: { id: "dealer", userId: "owner", regionId: "region", tier: "STARTER",
      isAdminPreview: false, role: "DEALER", disabledAt: null, deletedAt: null },
    binding: { id: "binding", registryKey: "mikes-motors", enabled: false, verifiedAt: new Date(0).toISOString() },
    activeListingCount: 0, listingCap: 30, listings: [], identities: [], actions,
  };
  const fingerprint = fingerprintSnapshot(snapshot);
  const report = {
    id: "report", dealerId: "dealer", bindingId: "binding", fingerprint, status: "APPROVED",
    approvedAt: new Date(1) as Date | null, approvedById: "approver" as string | null,
    plan: { actions, pendingReviewActions: [{ kind: "blocked", sourceIdentityKey: "other-car", reason: "missing-price" }] },
  };
  const binding = {
    id: "binding", dealerId: "dealer", registryKey: "mikes-motors", enabled: false,
    verifiedAt: new Date(0) as Date | null,
    dealer: { id: "dealer", isAdminPreview: false,
      user: { role: "DEALER", disabledAt: null as Date | null, deletedAt: null as Date | null } },
  };
  const previous: Job = {
    id: "failed", kind: "APPLY", status: "FAILED", reportId: "report", bindingId: "binding",
    dealerId: "dealer", idempotencyKey: "apply:report",
    payload: { reportId: "report", fingerprint, desktopApply: { receipts: ["deleted-media"] } },
  };
  let state = { report: report as typeof report | null, binding: binding as typeof binding | null,
    approver: { role: "ADMIN", disabledAt: null as Date | null, deletedAt: null as Date | null } as
      { role: string; disabledAt: Date | null; deletedAt: Date | null } | null,
    jobs: [previous] as Job[], audits: [] as unknown[] };
  let revision = 0;
  let auditError: Error | null = null;
  const clients: ReturnType<typeof transactionClient>[] = [];
  const matches = (job: Job, where: JobWhere) => Object.entries(where).every(([key, value]) =>
    key === "status" ? (value as { in: string[] }).in.includes(job.status) : job[key as keyof Job] === value);

  function transactionClient(draft: typeof state, dirty: () => void) {
    return {
      $queryRaw: vi.fn(async (_query: TemplateStringsArray, ..._values: unknown[]) => []),
      dealerStockSyncReport: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        draft.report?.id === where.id ? draft.report : null) },
      dealerStockSourceBinding: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        draft.binding?.id === where.id ? draft.binding : null) },
      user: { findUnique: vi.fn(async () => draft.approver) },
      dealerStockSyncJob: {
        findFirst: vi.fn(async ({ where }: { where: JobWhere }) => [...draft.jobs].reverse().find(job => matches(job, where)) ?? null),
        create: vi.fn(async ({ data }: { data: Omit<Job, "id" | "reportId"> & { reportId?: string | null } }) => {
          if (draft.jobs.some(job => job.idempotencyKey === data.idempotencyKey)) {
            throw new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" });
          }
          const job: Job = { ...data, reportId: data.reportId ?? null, id: "job-" + draft.jobs.length };
          draft.jobs.push(job); dirty(); return { id: job.id };
        }),
      },
      dealerStockSyncAudit: { create: vi.fn(async ({ data }: { data: unknown }) => {
        if (auditError) throw auditError;
        draft.audits.push(data); dirty(); return { id: "audit" };
      }) },
    };
  }

  mocks.snapshot.mockResolvedValue(snapshot);
  mocks.transaction.mockImplementation(async (work: (tx: ReturnType<typeof transactionClient>) => Promise<unknown>, options: unknown) => {
    expect(options).toMatchObject({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const version = revision;
    const draft = structuredClone(state);
    let dirty = false;
    const tx = transactionClient(draft, () => { dirty = true; });
    clients.push(tx);
    const result = await work(tx);
    if (version !== revision) throw commitConflict();
    if (dirty) { state = draft; revision += 1; }
    return result;
  });
  const retry = (expectedJobId = "failed") => recoverApprovedStock({ operation: "retry", reportId: "report", fingerprint, expectedJobId }, "actor");
  const fresh = () => recoverApprovedStock({ operation: "fresh", reportId: "report", fingerprint }, "actor");
  return { get state() { return state; }, clients, snapshot, fingerprint, retry, fresh,
    failAudit(error: Error) { auditError = error; } };
}

beforeEach(() => vi.resetAllMocks());

describe("approved stock recovery transaction", () => {
  it.each(["FAILED", "CANCELLED"])("retries %s with fresh media state and preserves approvals and remaining selections", async status => {
    const f = fixture();
    f.state.jobs[0].status = status;
    const before = structuredClone(f.state);
    const result = await f.retry();
    expect(result).toHaveProperty("data.status", "queued");
    expect(f.state.jobs).toHaveLength(2);
    expect(f.state.jobs[0]).toEqual(before.jobs[0]);
    expect(f.state.jobs[1]).toMatchObject({
      kind: "APPLY", status: "QUEUED", idempotencyKey: "apply-retry:failed", createdById: "actor",
      payload: { reportId: "report", fingerprint: f.fingerprint },
    });
    expect(f.state.jobs[1].payload).toEqual({ reportId: "report", fingerprint: f.fingerprint });
    expect(f.state.report).toEqual(before.report);
    expect(f.state.audits).toEqual([expect.objectContaining({
      action: "review-recovery-retry-apply", actorId: "actor", reportId: "report",
      before: { fingerprint: f.fingerprint, previousJobId: "failed" }, after: { jobId: "job-1" },
    })]);
    expect(f.state.binding?.enabled).toBe(false); // Weekly scheduling does not disable manual recovery.
    const locks = f.clients[0].$queryRaw.mock.calls.map(([query]) => query.join("?"));
    expect(locks).toEqual([
      expect.stringMatching(/DealerStockSourceBinding.*FOR UPDATE/),
      expect.stringMatching(/DealerProfile.*FOR UPDATE/),
      expect.stringMatching(/Listing.*FOR UPDATE/),
    ]);
    expect(mocks.snapshot).toHaveBeenCalledWith("dealer", before.report?.plan.actions, f.clients[0]);
  });

  it.each(["P2034", "P2002"])("converges concurrent retries after %s on one committed job and audit", async code => {
    const f = fixture(() => new Prisma.PrismaClientKnownRequestError("concurrent retry", {
      code, clientVersion: "test", meta: { target: ["idempotencyKey"] },
    }));
    const results = await Promise.all([f.retry(), f.retry()]);
    expect(results.map(result => result.data?.jobId)).toEqual(["job-1", "job-1"]);
    expect(f.state.jobs).toHaveLength(2);
    expect(f.state.audits).toHaveLength(1);
    expect(mocks.transaction).toHaveBeenCalledTimes(3); // The losing serializable attempt re-reads.
    expect(await f.retry()).toHaveProperty("data.status", "exists");
    expect(f.state.audits).toHaveLength(1);
  });

  it("retries a later failure once, but fences a stale earlier click", async () => {
    const f = fixture();
    await f.retry();
    f.state.jobs[1].status = "FAILED";
    expect(await f.retry()).toHaveProperty("error", expect.stringContaining("attempt changed"));
    expect(await f.retry("job-1")).toHaveProperty("data.jobId", "job-2");
    expect(f.state.jobs[2].idempotencyKey).toBe("apply-retry:job-1");
    expect(f.state.jobs[2].payload).toEqual({ reportId: "report", fingerprint: f.fingerprint });
  });

  it.each(["QUEUED", "LEASED"])("blocks both recovery operations when unrelated binding work is %s", async status => {
    const f = fixture();
    f.state.jobs.push({ ...f.state.jobs[0], id: "busy", kind: "SCRAPE", status, idempotencyKey: "busy" });
    expect(await f.retry()).toHaveProperty("error", expect.stringContaining("current stock task"));
    expect(await f.fresh()).toHaveProperty("error", expect.stringContaining("current stock task"));
    expect(f.state.jobs).toHaveLength(2);
    expect(f.state.audits).toHaveLength(0);
  });

  it("queues a manual fresh check through the real enqueue helper without changing the approval", async () => {
    const f = fixture();
    const before = structuredClone(f.state.report);
    expect(await f.fresh()).toHaveProperty("data.jobId", "job-1");
    expect(f.state.jobs[1]).toMatchObject({
      kind: "SCRAPE", status: "QUEUED", reportId: null, createdById: "actor",
      payload: { trigger: "ondemand", registryKey: "mikes-motors" },
    });
    expect(f.state.jobs[1].idempotencyKey).toMatch(/^ondemand:binding:/);
    expect(f.state.report).toEqual(before);
    expect(f.state.audits).toHaveLength(1);
    expect(f.state.audits[0]).toMatchObject({ action: "review-recovery-fresh-check" });
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("permits only one active job when fresh and retry requests overlap", async () => {
    const f = fixture();
    const results = await Promise.all([f.fresh(), f.retry()]);
    expect(results.filter(result => result.data)).toHaveLength(1);
    expect(results.filter(result => result.error)).toHaveLength(1);
    expect(f.state.jobs.filter(job => job.status === "QUEUED")).toHaveLength(1);
    expect(f.state.audits).toHaveLength(1);
  });

  const refusals: Array<[string, (f: ReturnType<typeof fixture>) => void]> = [
    ["missing report", f => { f.state.report = null; }],
    ["unapproved report", f => { f.state.report!.status = "PENDING_REVIEW"; }],
    ["changed fingerprint", f => { f.state.report!.fingerprint = "b".repeat(64); }],
    ["mismatched dealer", f => { f.state.report!.dealerId = "other"; }],
    ["mismatched binding", f => { f.state.report!.bindingId = "other"; }],
    ["missing binding", f => { f.state.binding = null; }],
    ["unverified website", f => { f.state.binding!.verifiedAt = null; }],
    ["unknown registry", f => { f.state.binding!.registryKey = "unknown"; }],
    ["disabled dealer", f => { f.state.binding!.dealer.user.disabledAt = new Date(); }],
    ["deleted dealer", f => { f.state.binding!.dealer.user.deletedAt = new Date(); }],
    ["wrong dealer role", f => { f.state.binding!.dealer.user.role = "USER"; }],
    ["admin preview dealer", f => { f.state.binding!.dealer.isAdminPreview = true; }],
    ["missing attempt", f => { f.state.jobs = []; }],
    ["successful attempt", f => { f.state.jobs[0].status = "SUCCEEDED"; }],
    ["mismatched attempt payload", f => { f.state.jobs[0].payload = { reportId: "report", fingerprint: "b".repeat(64) }; }],
    ["mismatched attempt dealer", f => { f.state.jobs[0].dealerId = "other"; }],
    ["missing approval time", f => { f.state.report!.approvedAt = null; }],
    ["missing approval actor", f => { f.state.report!.approvedById = null; }],
    ["missing approver", f => { f.state.approver = null; }],
    ["revoked approver", f => { f.state.approver!.role = "USER"; }],
    ["disabled approver", f => { f.state.approver!.disabledAt = new Date(); }],
    ["deleted approver", f => { f.state.approver!.deletedAt = new Date(); }],
    ["empty approved plan", f => { f.state.report!.plan.actions = []; }],
    ["stale listing snapshot", f => { f.snapshot.activeListingCount += 1; }],
    ["stale snapshot dealer", f => { f.snapshot.dealer.id = "other"; }],
    ["stale snapshot binding", f => { f.snapshot.binding.id = "other"; }],
    ["missing current snapshot", () => { mocks.snapshot.mockResolvedValue(null); }],
  ];
  it.each(refusals)("refuses %s without queue, report or audit mutation", async (_label, change) => {
    const f = fixture();
    change(f);
    const before = structuredClone(f.state);
    expect(await f.retry()).toHaveProperty("error");
    expect(f.state).toEqual(before);
  });

  it("fences a report whose binding changes between its initial read and lock", async () => {
    const f = fixture();
    mocks.transaction.mockImplementationOnce(async work => {
      const result = await work({
        $queryRaw: vi.fn(async () => []),
        dealerStockSyncReport: { findUnique: vi.fn().mockResolvedValueOnce({ bindingId: "before" })
          .mockResolvedValueOnce(f.state.report) },
      });
      return result;
    });
    expect(await f.retry()).toHaveProperty("error", expect.stringContaining("attempt changed"));
    expect(f.state.jobs).toHaveLength(1);
  });

  it.each(["retry", "fresh"] as const)("rolls back the queued %s job if its audit fails", async operation => {
    const f = fixture();
    const before = structuredClone(f.state);
    f.failAudit(new Error("audit failed"));
    await expect(f[operation]()).rejects.toThrow("audit failed");
    expect(f.state).toEqual(before);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    { operation: "retry", target: ["id"], label: "unrelated unique constraint" },
    { operation: "retry", target: undefined, label: "unidentified unique constraint" },
    { operation: "fresh", target: ["idempotencyKey"], label: "fresh-check unique constraint" },
  ] as const)("does not retry a $label", async ({ operation, target }) => {
    const f = fixture();
    mocks.transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002", clientVersion: "test", meta: { target },
    }));
    await expect(f[operation]()).rejects.toMatchObject({ code: "P2002" });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(f.state.jobs).toHaveLength(1);
  });

  it("bounds an exhausted retry-key conflict as well", async () => {
    const f = fixture();
    mocks.transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002", clientVersion: "test", meta: { target: ["idempotencyKey"] },
    }));
    await expect(f.retry()).rejects.toMatchObject({ code: "P2002" });
    expect(mocks.transaction).toHaveBeenCalledTimes(3);
    expect(f.state.jobs).toHaveLength(1);
  });

  it("bounds transient conflict retries, and never retries unrelated errors", async () => {
    const f = fixture();
    mocks.transaction.mockRejectedValueOnce(conflict()).mockRejectedValueOnce(conflict());
    expect(await f.retry()).toHaveProperty("data.jobId", "job-1");
    expect(mocks.transaction).toHaveBeenCalledTimes(3);
    mocks.transaction.mockClear().mockRejectedValue(conflict());
    await expect(f.retry()).rejects.toMatchObject({ code: "P2034" });
    expect(mocks.transaction).toHaveBeenCalledTimes(3);
    mocks.transaction.mockClear().mockRejectedValue(new Error("database unavailable"));
    await expect(f.retry()).rejects.toThrow("database unavailable");
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
});

describe("report recovery metadata independent of result history", () => {
  it("loads old attempts directly in two batched queries, with no history or recent-job cap", async () => {
    const f = fixture();
    const report = f.state.report!;
    const second = { ...report, id: "report-2", bindingId: "binding-2" };
    mocks.findMany.mockImplementation(async ({ where }) => where.reportId
      ? [f.state.jobs[0], { ...f.state.jobs[0], id: "cancelled", reportId: second.id, bindingId: second.bindingId,
        status: "CANCELLED", payload: { reportId: second.id, fingerprint: second.fingerprint } }]
      : [{ id: "busy", bindingId: second.bindingId, kind: "SCRAPE", status: "LEASED" }]);
    const results = await decorateStockApplyRecovery([report, second, { ...report, id: "pending", status: "PENDING_REVIEW" }]);
    expect(results[0].applyRecovery).toMatchObject({ retryable: true, attempt: { id: "failed", status: "FAILED" } });
    expect(results[1].applyRecovery).toMatchObject({ retryable: false, activeJob: { id: "busy" } });
    expect(results[2].applyRecovery).toBeNull();
    expect(mocks.findMany).toHaveBeenCalledTimes(2);
    const requests = mocks.findMany.mock.calls.map(([request]) => request);
    expect(requests[0]).toMatchObject({ where: { reportId: { in: ["report", "report-2"] }, kind: "APPLY" }, distinct: ["reportId"] });
    expect(requests[1]).toMatchObject({ where: { bindingId: { in: ["binding", "binding-2"] }, status: { in: ["QUEUED", "LEASED"] } } });
    requests.forEach(request => expect(request).not.toHaveProperty("take"));
  });

  it("requires a fresh check when no matching attempt exists, without inventing a failure", async () => {
    const f = fixture();
    mocks.findMany.mockResolvedValue([]);
    expect((await decorateStockApplyRecovery([f.state.report!]))[0].applyRecovery)
      .toMatchObject({ attempt: null, retryable: false, reason: expect.stringContaining("fresh check") });
  });

  it("does no job queries for reports that do not need approved-job recovery", async () => {
    const f = fixture();
    expect((await decorateStockApplyRecovery([{ ...f.state.report!, status: "APPLIED" }]))[0].applyRecovery).toBeNull();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});

import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DesktopPrincipal } from "@/lib/dealer-stock-sync/desktop-service";
import {
  DESKTOP_JOB_LEASE_MS,
  DESKTOP_JOB_RATE_LIMIT,
  DESKTOP_JOB_RATE_WINDOW_SECONDS,
  desktopLeaseOwner,
  handleDesktopJob,
  type DesktopApplyStepInput,
  type DesktopApplyStepResult,
  type DesktopBindingRecord,
  type DesktopFailScrapeInput,
  type DesktopJobDependencies,
  type DesktopJobLeasePatch,
  type DesktopJobLeaseWhere,
  type DesktopJobRecord,
  type DesktopReportRecord,
  type DesktopJobResponse,
} from "@/lib/dealer-stock-sync/desktop-jobs";
import type { PipelineResult } from "@/scripts/dealer-stock-sync/types";
import { enqueueApplyJob } from "@/lib/dealer-stock-sync/enqueue";

const ADMIN = "cadmin0000000000000000001";
const DEVICE = "dev_abcdefghijklmnopqrstuv";
const OTHER_DEVICE = "dev_zyxwvutsrqponmlkjihgfe";
const JOB_ID = "cjob000000000000000000001";
const BINDING_ID = "cbind00000000000000000001";
const DEALER_ID = "cdealer000000000000000001";
const NOW = new Date("2026-10-22T12:00:00.000Z");
const CARS = "https://www.mikesmotors.im/used-cars";
const VANS = "https://www.mikesmotors.im/used-vans";
const BIKES = "https://www.mikesmotors.im/used-bikes";
const CDN = "https://images.clickdealer.co.uk/vehicles/8324/8324646/full/204251334.jpg";

const principal: DesktopPrincipal = { adminId: ADMIN, deviceId: DEVICE, environment: "preview" };

function token(): string {
  return randomBytes(32).toString("base64url");
}

function ownedJob(leaseToken: string, overrides: Partial<DesktopJobRecord> = {}): DesktopJobRecord {
  return {
    id: JOB_ID,
    kind: "SCRAPE",
    status: "LEASED",
    bindingId: BINDING_ID,
    dealerId: DEALER_ID,
    reportId: null,
    leaseOwner: desktopLeaseOwner(principal, leaseToken),
    leaseExpiresAt: new Date(NOW.getTime() + DESKTOP_JOB_LEASE_MS),
    payload: overrides.kind === "APPLY"
      ? { reportId: overrides.reportId, fingerprint: "f".repeat(64) }
      : { registryKey: "mikes-motors" },
    ...overrides,
  };
}

function binding(overrides: Partial<DesktopBindingRecord> = {}): DesktopBindingRecord {
  return {
    id: BINDING_ID,
    dealerId: DEALER_ID,
    registryKey: "mikes-motors",
    verifiedAt: new Date("2026-10-01T00:00:00.000Z"),
    ...overrides,
  };
}

function approvedReport(overrides: Partial<DesktopReportRecord> = {}): DesktopReportRecord {
  return {
    id: "creport000000000000000001", bindingId: BINDING_ID, dealerId: DEALER_ID,
    fingerprint: "f".repeat(64), status: "APPROVED", approvedById: ADMIN,
    ...overrides,
  };
}

function harness(options: {
  job?: DesktopJobRecord | null;
  binding?: DesktopBindingRecord | null;
  report?: DesktopReportRecord | null;
  findReport?: DesktopJobDependencies["reports"]["findById"];
  principal?: DesktopPrincipal;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  beforeJobRead?: () => void;
  authorize?: DesktopJobDependencies["authorize"];
  assertEnvironment?: DesktopJobDependencies["assertEnvironment"];
  consumeRate?: DesktopJobDependencies["consumeRate"];
  leaseOneJob?: DesktopJobDependencies["leaseOneJob"];
  runLeasedJob?: DesktopJobDependencies["runLeasedJob"];
  readiness?: DesktopJobDependencies["readiness"];
  failScrape?: DesktopJobDependencies["failScrape"];
  applyStep?: DesktopJobDependencies["applyStep"];
} = {}) {
  const state = {
    job: options.job === undefined ? null : options.job,
    binding: options.binding === undefined ? binding() : options.binding,
    report: options.report === undefined ? approvedReport() : options.report,
    updates: [] as DesktopJobLeasePatch[],
    leaseCalls: 0,
    runCalls: 0,
    failCalls: [] as DesktopFailScrapeInput[],
    stepCalls: [] as DesktopApplyStepInput[],
    readyCalls: 0,
    rateCalls: [] as Array<{ bucket: string; limit: number; windowSeconds: number }>,
    guards: 0,
    parsed: null as PipelineResult | null,
  };
  const env = options.env ?? { DEALER_STOCK_DESKTOP_API_ONLY: "1" };
  const who = options.principal ?? principal;
  let allowance = DESKTOP_JOB_RATE_LIMIT;
  const deps: DesktopJobDependencies = {
    env,
    now: options.now ?? (() => new Date(NOW.getTime())),
    authorize: options.authorize ?? (async () => ({ ok: true, principal: who })),
    assertEnvironment: options.assertEnvironment ?? (() => "preview"),
    consumeRate: options.consumeRate ?? (async (bucket, limit, windowSeconds) => {
      state.rateCalls.push({ bucket, limit, windowSeconds });
      if (allowance <= 0) return false;
      allowance -= 1;
      return true;
    }),
    randomBytes,
    leaseOneJob: options.leaseOneJob ?? (async () => {
      state.leaseCalls += 1;
      return null;
    }),
    runLeasedJob: options.runLeasedJob ?? (async (lease, scrape) => {
      state.runCalls += 1;
      if (!state.job || state.job.leaseOwner !== lease.owner) return;
      try {
        state.parsed = await scrape("mikes-motors");
        state.job = { ...state.job, status: "SUCCEEDED" };
      } catch {
        state.job = { ...state.job, status: "FAILED" };
      }
    }),
    jobs: {
      async findById(id) {
        options.beforeJobRead?.();
        return state.job?.id === id ? state.job : null;
      },
      async updateMany(args) {
        state.updates.push(args.data);
        if (!state.job || !matches(state.job, args.where)) return { count: 0 };
        state.job = {
          ...state.job,
          status: args.data.status ?? state.job.status,
          leaseOwner: args.data.leaseOwner ?? state.job.leaseOwner,
          leaseExpiresAt: "leaseExpiresAt" in args.data ? args.data.leaseExpiresAt ?? null : state.job.leaseExpiresAt,
        };
        return { count: 1 };
      },
    },
    bindings: { async findById(id) { return state.binding?.id === id ? state.binding : null; } },
    reports: { findById: options.findReport ?? (async (id) => state.report?.id === id ? state.report : null) },
    readiness: options.readiness ?? (async () => {
      state.readyCalls += 1;
      return true;
    }),
    failScrape: options.failScrape ?? (async (input) => {
      state.failCalls.push(input);
      if (!state.job || state.job.leaseOwner !== input.busyOwner || state.job.status !== "LEASED") return "lost";
      state.job = { ...state.job, status: "FAILED", leaseExpiresAt: null };
      return "failed";
    }),
    applyStep: options.applyStep ?? (async () => ({ outcome: "unavailable" })),
  };
  if (options.applyStep) {
    const inner = options.applyStep;
    deps.applyStep = async (input, guard) => {
      state.stepCalls.push(input);
      return inner(input, guard);
    };
  } else {
    deps.applyStep = async (input) => {
      state.stepCalls.push(input);
      return { outcome: "unavailable" };
    };
  }
  return {
    env,
    state,
    post: (body: unknown, authorization: string | null = "Bearer token") => handleDesktopJob(deps, { body, authorization }),
  };
}

function matches(job: DesktopJobRecord, where: DesktopJobLeaseWhere): boolean {
  return job.id === where.id &&
    job.status === where.status &&
    job.leaseOwner === where.leaseOwner &&
    job.leaseExpiresAt !== null &&
    job.leaseExpiresAt.getTime() > where.leaseExpiresAt.gt.getTime();
}

function vehicle(stamp: string) {
  return {
    dealerKey: "mikes-motors",
    sourceKey: "used-cars",
    platform: "click-dealer",
    sourceVehicleId: "8324646",
    registration: "MNZ123A",
    vin: null,
    stockReference: null,
    make: "Ford",
    model: "Fiesta",
    derivative: null,
    year: 2019,
    firstRegistrationDate: null,
    mileage: 32000,
    pricePence: 899500,
    isPoa: false,
    fuel: "Petrol",
    transmission: "Manual",
    bodyType: "Hatchback",
    colour: "Blue",
    doors: 5,
    seats: 5,
    engineSize: 1.2,
    enginePower: 100,
    vehicleType: "car",
    description: "One owner.",
    locationName: null,
    detailUrl: `${CARS}/ford-fiesta-8324646`,
    imageUrls: [CDN],
    availability: "available",
    sourceCreatedAt: null,
    sourceUpdatedAt: null,
    scrapedAt: stamp,
    provenance: { startUrl: CARS, sourceKeys: ["used-cars"], rawIdentityHints: ["8324646"] },
  };
}

function source(key: string, startUrl: string, vehicles: unknown[]) {
  return {
    dealerKey: "mikes-motors",
    sourceKey: key,
    platform: "click-dealer",
    status: "ok",
    error: null,
    startUrl,
    pagesFetched: 1,
    advertisedCount: vehicles.length,
    rawCount: vehicles.length,
    vehicles,
    detailMissing: 0,
    paginationUncertain: false,
  };
}

function submission(extra: Record<string, unknown> = {}) {
  const scrapeStartedAt = new Date().toISOString();
  const scrapeFinishedAt = new Date(Date.now() + 1000).toISOString();
  return {
    sourceResults: [
      source("used-bikes", BIKES, []),
      source("used-vans", VANS, []),
      source("used-cars", CARS, [vehicle(scrapeStartedAt)]),
    ],
    scrapeStartedAt,
    scrapeFinishedAt,
    ...extra,
  };
}

describe("desktop jobs", () => {
  it("accepts the actual enqueueApplyJob payload without a SCRAPE registry field", async () => {
    let payload: unknown;
    const client = { dealerStockSyncJob: {
      findFirst: async () => null,
      create: async ({ data }: { data: { payload: unknown } }) => {
        payload = data.payload;
        return { id: JOB_ID, status: "QUEUED" };
      },
    } } as unknown as Parameters<typeof enqueueApplyJob>[0];
    await enqueueApplyJob(client, {
      bindingId: BINDING_ID, dealerId: DEALER_ID, reportId: "creport000000000000000001",
      fingerprint: "f".repeat(64), actorId: ADMIN,
    });
    expect(payload).toEqual({ reportId: "creport000000000000000001", fingerprint: "f".repeat(64) });
    const job = ownedJob(token(), {
      kind: "APPLY", reportId: "creport000000000000000001", status: "QUEUED",
      leaseOwner: null, leaseExpiresAt: null, payload,
    });
    const api = harness({
      job,
      leaseOneJob: async (owner, now, guard) => {
        guard();
        job.status = "LEASED";
        job.leaseOwner = owner;
        job.leaseExpiresAt = new Date(now.getTime() + DESKTOP_JOB_LEASE_MS);
        return { id: job.id, owner };
      },
      applyStep: async () => ({ outcome: "continue" }),
    });
    const leased = leasedJob(await api.post({ op: "lease" }));
    expect(leased).toMatchObject({ kind: "APPLY", registryKey: "mikes-motors" });
    expect(await api.post({ op: "step", jobId: leased.id, leaseToken: leased.leaseToken }))
      .toEqual({ ok: true, status: 200, body: { status: "continue" } });
  });

  it("does not restore an expired busy lease after a step", async () => {
    const leaseToken = token();
    let now = new Date(NOW);
    const api = harness({
      job: ownedJob(leaseToken, { kind: "APPLY", reportId: "creport000000000000000001" }),
      now: () => now,
      applyStep: async () => {
        now = new Date(NOW.getTime() + DESKTOP_JOB_LEASE_MS + 1);
        return { outcome: "continue" };
      },
    });
    expect(await api.post({ op: "step", jobId: JOB_ID, leaseToken }))
      .toEqual({ ok: false, status: 409, error: "conflict" });
    expect(api.state.job?.leaseOwner).not.toBe(desktopLeaseOwner(principal, leaseToken));
  });

  it("does not revive a lease that expired during the heartbeat read", async () => {
    const leaseToken = token();
    let now = new Date(NOW);
    const api = harness({
      job: ownedJob(leaseToken, { leaseExpiresAt: new Date(NOW.getTime() + 1000) }),
      now: () => now,
      beforeJobRead: () => { now = new Date(NOW.getTime() + 2000); },
    });
    expect(await api.post({ op: "heartbeat", jobId: JOB_ID, leaseToken }))
      .toEqual({ ok: false, status: 409, error: "conflict" });
    expect(api.state.updates).toHaveLength(0);
  });

  it.each([
    ["missing report", null],
    ["wrong binding", approvedReport({ bindingId: "cotherbinding" })],
    ["wrong dealer", approvedReport({ dealerId: "cotherdealer" })],
    ["changed fingerprint", approvedReport({ fingerprint: "e".repeat(64) })],
    ["approval withdrawn", approvedReport({ status: "PENDING_REVIEW" })],
    ["missing approver", approvedReport({ approvedById: null })],
  ] as const)("rejects APPLY with %s before a busy claim or photo operation", async (_case, report) => {
    const leaseToken = token();
    const api = harness({
      job: ownedJob(leaseToken, { kind: "APPLY", reportId: "creport000000000000000001" }),
      report,
      applyStep: async () => ({ outcome: "continue" }),
    });
    expect(await api.post({ op: "step", jobId: JOB_ID, leaseToken }))
      .toEqual({ ok: false, status: 409, error: "conflict" });
    expect(api.state.updates).toHaveLength(0);
    expect(api.state.stepCalls).toHaveLength(0);
  });

  it("rejects a mismatched APPLY payload and unavailable report store without claiming work", async () => {
    const leaseToken = token();
    const mismatched = harness({ job: ownedJob(leaseToken, {
      kind: "APPLY", reportId: "creport000000000000000001",
      payload: { reportId: "creport000000000000000002", fingerprint: "f".repeat(64) },
    }) });
    expect(await mismatched.post({ op: "step", jobId: JOB_ID, leaseToken }))
      .toEqual({ ok: false, status: 409, error: "conflict" });
    expect(mismatched.state.updates).toHaveLength(0);

    const unavailable = harness({
      job: ownedJob(leaseToken, { kind: "APPLY", reportId: "creport000000000000000001" }),
      findReport: async () => { throw new Error("database password=secret"); },
    });
    expect(await unavailable.post({ op: "step", jobId: JOB_ID, leaseToken }))
      .toEqual({ ok: false, status: 503, error: "unavailable" });
    expect(unavailable.state.updates).toHaveLength(0);
  });

  it("rejects strict shapes and client plan fields before any job work", async () => {
    const leaseToken = token();
    const api = harness({ job: ownedJob(leaseToken) });
    const bodies = [
      { op: "lease", jobId: JOB_ID, dealerId: DEALER_ID },
      { op: "check", config: { databaseUrl: "postgres://secret" } },
      { op: "heartbeat", jobId: JOB_ID, leaseToken, photo: "https://cdn.example/a.jpg" },
      { op: "submit", jobId: JOB_ID, leaseToken, result: {}, plan: { actions: [{ fingerprint: "forged" }] } },
      { op: "fail", jobId: JOB_ID, leaseToken, reason: "timed_out", error: "dealer stack trace" },
      { op: "step", jobId: JOB_ID, leaseToken, approval: true, fingerprint: "abc" },
      { op: "lease", registryKey: "ocean-motor-village" },
    ];
    for (const body of bodies) {
      const response = await api.post(body);
      expect(response).toEqual({ ok: false, status: 400, error: "invalid_request" });
    }
    expect(api.state.leaseCalls).toBe(0);
    expect(api.state.runCalls).toBe(0);
    expect(api.state.failCalls).toHaveLength(0);
    expect(api.state.stepCalls).toHaveLength(0);
    expect(api.state.updates).toHaveLength(0);
  });

  it("authorises every operation and rejects revoked sessions, cross-environment, and disabled API mode", async () => {
    const revoked = harness({
      authorize: async () => ({ ok: false, status: 401, error: "unauthorized" }),
    });
    expect(await revoked.post({ op: "lease" })).toEqual({ ok: false, status: 401, error: "unauthorized" });
    expect(revoked.state.leaseCalls).toBe(0);

    const cross = harness({
      principal: { ...principal, environment: "production" },
      assertEnvironment: () => "preview",
    });
    expect(await cross.post({ op: "check" })).toEqual({ ok: false, status: 403, error: "forbidden" });
    expect(cross.state.readyCalls).toBe(0);

    const thrown = harness({
      assertEnvironment: () => { throw new Error("postgres://worker:secret-password@db.example/app"); },
    });
    const blocked = await thrown.post({ op: "lease" });
    expect(blocked).toEqual({ ok: false, status: 503, error: "unavailable" });
    expect(JSON.stringify(blocked)).not.toContain("secret-password");
    expect(thrown.state.leaseCalls).toBe(0);

    const disabled = harness({ env: { DEALER_STOCK_DESKTOP_API_ONLY: "0" } });
    expect(await disabled.post({ op: "check" })).toEqual({ ok: false, status: 503, error: "unavailable" });
    expect(disabled.state.readyCalls).toBe(0);
    expect(disabled.env.DEALER_STOCK_DESKTOP_API_ONLY).toBe("0");
  });

  it("rate limits each device to the scrape heartbeat and photo-step budget", async () => {
    const api = harness();
    for (let index = 0; index < DESKTOP_JOB_RATE_LIMIT; index += 1) {
      expect(await api.post({ op: "check" })).toEqual({ ok: true, status: 200, body: { ready: true } });
    }
    expect(await api.post({ op: "lease" })).toEqual({ ok: false, status: 429, error: "rate_limited" });
    expect(api.state.leaseCalls).toBe(0);
    expect(api.state.readyCalls).toBe(DESKTOP_JOB_RATE_LIMIT);
    expect(api.state.rateCalls[0]).toEqual({
      bucket: `desktop-jobs:preview:${DEVICE}`,
      limit: DESKTOP_JOB_RATE_LIMIT,
      windowSeconds: DESKTOP_JOB_RATE_WINDOW_SECONDS,
    });
  });

  it("returns only the server-selected lease, bound to a random device token", async () => {
    const selected = "cjob000000000000000000002";
    const queued: DesktopJobRecord = {
      ...ownedJob(token()),
      id: selected,
      status: "QUEUED",
      leaseOwner: null,
      leaseExpiresAt: null,
    };
    const owners: string[] = [];
    let seenGuard = false;
    const api = harness({
      job: queued,
      leaseOneJob: async (owner, now, guard) => {
        seenGuard = true;
        guard();
        owners.push(owner);
        queued.status = "LEASED";
        queued.leaseOwner = owner;
        queued.leaseExpiresAt = new Date(now.getTime() + DESKTOP_JOB_LEASE_MS);
        return { id: selected, owner };
      },
    });
    const first = leasedJob(await api.post({ op: "lease" }));
    const second = leasedJob(await api.post({ op: "lease" }));
    expect(first.id).toBe(selected);
    expect(first.kind).toBe("SCRAPE");
    expect(first.registryKey).toBe("mikes-motors");
    expect(Object.keys(first).sort()).toEqual(["id", "kind", "leaseToken", "registryKey"]);
    expect(Buffer.from(first.leaseToken, "base64url")).toHaveLength(32);
    expect(first.leaseToken).not.toBe(second.leaseToken);
    const canonical = JSON.stringify(["desktop-lease-v1", "preview", ADMIN, DEVICE, first.leaseToken]);
    expect(owners[0]).toBe(createHash("sha256").update(canonical).digest("hex"));
    expect(first.leaseToken).not.toBe(owners[0]);
    expect(seenGuard).toBe(true);
    expect(JSON.stringify(first)).not.toContain(DEALER_ID);

    const empty = harness({ leaseOneJob: async () => null });
    expect(await empty.post({ op: "lease" })).toEqual({ ok: true, status: 200, body: { job: null } });
  });

  it("extends only an active regular owner and rejects expired, foreign, and busy receipts", async () => {
    const leaseToken = token();
    const api = harness({ job: ownedJob(leaseToken) });
    expect(await api.post({ op: "heartbeat", jobId: JOB_ID, leaseToken })).toEqual({
      ok: true,
      status: 200,
      body: { status: "extended" },
    });
    expect(api.state.job?.leaseOwner).toBe(desktopLeaseOwner(principal, leaseToken));
    expect(api.state.job?.leaseExpiresAt?.toISOString()).toBe(new Date(NOW.getTime() + DESKTOP_JOB_LEASE_MS).toISOString());

    const expired = harness({
      job: ownedJob(leaseToken, { leaseExpiresAt: new Date(NOW.getTime() - 1) }),
    });
    expect(await expired.post({ op: "heartbeat", jobId: JOB_ID, leaseToken })).toEqual({
      ok: false,
      status: 409,
      error: "conflict",
    });
    expect(expired.state.updates).toHaveLength(0);

    const foreignDevice = harness({
      job: ownedJob(leaseToken),
      principal: { ...principal, deviceId: OTHER_DEVICE },
    });
    expect(await foreignDevice.post({ op: "heartbeat", jobId: JOB_ID, leaseToken })).toEqual({
      ok: false,
      status: 409,
      error: "conflict",
    });

    const foreignEnvironment = harness({
      job: ownedJob(leaseToken, {
        leaseOwner: desktopLeaseOwner({ ...principal, environment: "production" }, leaseToken),
      }),
    });
    expect(await foreignEnvironment.post({ op: "submit", jobId: JOB_ID, leaseToken, result: {} })).toEqual({
      ok: false,
      status: 409,
      error: "conflict",
    });
    expect(foreignEnvironment.state.runCalls).toBe(0);

    const busy = harness({
      job: ownedJob(leaseToken, { leaseOwner: "a".repeat(64) }),
    });
    expect(await busy.post({ op: "heartbeat", jobId: JOB_ID, leaseToken })).toEqual({
      ok: false,
      status: 409,
      error: "conflict",
    });
    expect(busy.state.job?.leaseExpiresAt?.toISOString()).toBe(new Date(NOW.getTime() + DESKTOP_JOB_LEASE_MS).toISOString());
  });

  it("submits only a rebuilt registry result and trusts the terminal job row", async () => {
    const leaseToken = token();
    const api = harness({ job: ownedJob(leaseToken) });
    const forged = await api.post({
      op: "submit",
      jobId: JOB_ID,
      leaseToken,
      result: { ...submission(), plan: { actions: [] }, dealer: { key: "forged" }, fingerprint: "abc", canArchive: true },
    });
    expect(forged).toEqual({ ok: false, status: 400, error: "invalid_request" });
    expect(JSON.stringify(forged)).not.toContain("mikes-motors");
    expect(api.state.runCalls).toBe(0);
    expect(api.state.job?.leaseOwner).toBe(desktopLeaseOwner(principal, leaseToken));

    const accepted = await api.post({ op: "submit", jobId: JOB_ID, leaseToken, result: submission() });
    expect(accepted).toEqual({ ok: true, status: 200, body: { status: "succeeded" } });
    expect(api.state.parsed?.dealer.key).toBe("mikes-motors");
    expect(api.state.parsed?.canArchive).toBe(true);
    expect(api.state.parsed).not.toHaveProperty("plan");
    expect(Object.keys(api.state.parsed ?? {}).sort()).toEqual([
      "canArchive",
      "dealer",
      "reconciled",
      "scrapeFinishedAt",
      "scrapeStartedAt",
      "sourceResults",
    ]);

    const replay = await api.post({ op: "submit", jobId: JOB_ID, leaseToken, result: submission() });
    expect(replay).toEqual({ ok: false, status: 409, error: "conflict" });
    expect(api.state.runCalls).toBe(1);

    const stalled = harness({
      job: ownedJob(leaseToken),
      runLeasedJob: async () => undefined,
    });
    expect(await stalled.post({ op: "submit", jobId: JOB_ID, leaseToken, result: submission() })).toEqual({
      ok: false,
      status: 409,
      error: "conflict",
    });

    const exploded = harness({
      job: ownedJob(leaseToken),
      runLeasedJob: async () => { throw new Error("Invalid prisma.dealerStockSyncJob registry mikes-motors password=secret"); },
    });
    const safe = await exploded.post({ op: "submit", jobId: JOB_ID, leaseToken, result: submission() });
    expect(safe).toEqual({ ok: false, status: 503, error: "unavailable" });
    expect(JSON.stringify(safe)).not.toContain("secret");
    expect(JSON.stringify(safe)).not.toContain("mikes-motors");
  });

  it("lets one concurrent receipt win and does not rerun a lost compare-and-set", async () => {
    const leaseToken = token();
    const api = harness({ job: ownedJob(leaseToken) });
    const body = { op: "fail", jobId: JOB_ID, leaseToken, reason: "browser_failed" };
    const [left, right] = await Promise.all([api.post(body), api.post(body)]);
    const statuses = [left, right].map((response) => response.ok && "status" in response.body ? response.body.status : response.status).sort();
    expect(statuses).toEqual([409, "failed"]);
    expect(api.state.failCalls).toHaveLength(1);
    expect(api.state.failCalls[0]?.failureReason).toBe("source-failed");
    expect(JSON.stringify(api.state.failCalls)).not.toContain("browser_failed");
    expect(await api.post(body)).toEqual({ ok: false, status: 409, error: "conflict" });
    expect(api.state.failCalls).toHaveLength(1);
  });

  it("fails a scrape through the server reason and keeps client text out of the result", async () => {
    const leaseToken = token();
    const api = harness({ job: ownedJob(leaseToken) });
    expect(await api.post({ op: "fail", jobId: JOB_ID, leaseToken, reason: "drop table" })).toEqual({
      ok: false,
      status: 400,
      error: "invalid_request",
    });
    const failed = await api.post({ op: "fail", jobId: JOB_ID, leaseToken, reason: "source_unavailable" });
    expect(failed).toEqual({ ok: true, status: 200, body: { status: "failed" } });
    expect(api.state.failCalls[0]).toMatchObject({
      jobId: JOB_ID,
      bindingId: BINDING_ID,
      dealerId: DEALER_ID,
      failureReason: "source-failed",
    });
    expect(api.state.job?.status).toBe("FAILED");
    expect(JSON.stringify(failed)).not.toContain("source_unavailable");
    expect(JSON.stringify(failed)).not.toContain("source-failed");

    const apply = harness({ job: ownedJob(leaseToken, { kind: "APPLY", reportId: "creport000000000000000001" }) });
    expect(await apply.post({ op: "fail", jobId: JOB_ID, leaseToken, reason: "timed_out" })).toEqual({
      ok: false,
      status: 409,
      error: "conflict",
    });
    expect(apply.state.failCalls).toHaveLength(0);
  });
  it("labels rejected worker data separately from a website failure", async () => {
    const leaseToken = token();
    const api = harness({ job: ownedJob(leaseToken) });
    await api.post({ op: "fail", jobId: JOB_ID, leaseToken, reason: "incomplete" });
    expect(api.state.failCalls[0]?.failureReason).toBe("submission-invalid");
  });

  it("fails closed on apply steps, restores only a continuing owner, and ignores a false terminal claim", async () => {
    const leaseToken = token();
    const regular = desktopLeaseOwner(principal, leaseToken);
    const closed = harness({
      job: ownedJob(leaseToken, { kind: "APPLY", reportId: "creport000000000000000001" }),
    });
    const unavailable = await closed.post({ op: "step", jobId: JOB_ID, leaseToken });
    expect(unavailable).toEqual({ ok: false, status: 503, error: "unavailable" });
    expect(closed.state.stepCalls).toHaveLength(1);
    expect(closed.state.job?.status).toBe("LEASED");
    expect(closed.state.job?.leaseOwner).not.toBe(regular);
    expect(closed.state.job?.leaseOwner).toMatch(/^[a-f0-9]{64}$/);
    expect(await closed.post({ op: "step", jobId: JOB_ID, leaseToken })).toEqual({
      ok: false,
      status: 409,
      error: "conflict",
    });
    expect(closed.state.stepCalls).toHaveLength(1);

    const continuing = harness({
      job: ownedJob(leaseToken, { kind: "APPLY", reportId: "creport000000000000000001" }),
      applyStep: async () => ({ outcome: "continue" }) satisfies DesktopApplyStepResult,
    });
    expect(await continuing.post({ op: "step", jobId: JOB_ID, leaseToken })).toEqual({
      ok: true,
      status: 200,
      body: { status: "continue" },
    });
    expect(continuing.state.job?.leaseOwner).toBe(regular);
    expect(continuing.state.job?.status).toBe("LEASED");

    const pretended = harness({
      job: ownedJob(leaseToken, { kind: "APPLY", reportId: "creport000000000000000001" }),
      applyStep: async () => ({ outcome: "succeeded" }),
    });
    expect(await pretended.post({ op: "step", jobId: JOB_ID, leaseToken })).toEqual({
      ok: false,
      status: 409,
      error: "conflict",
    });
    expect(pretended.state.job?.status).toBe("LEASED");
    expect(JSON.stringify(unavailable)).not.toContain("http");
  });

  it("keeps check read-only and passes the environment guard into the lease", async () => {
    const reads: string[] = [];
    const api = harness({
      readiness: async () => {
        reads.push("readiness");
        return true;
      },
      leaseOneJob: async () => {
        reads.push("lease");
        return null;
      },
    });
    expect(await api.post({ op: "check" })).toEqual({ ok: true, status: 200, body: { ready: true } });
    expect(reads).toEqual(["readiness"]);
    expect(api.state.updates).toHaveLength(0);
    expect(api.state.failCalls).toHaveLength(0);
    expect(api.state.stepCalls).toHaveLength(0);

    let guardCalls = 0;
    const guarded = harness({
      assertEnvironment: () => {
        guardCalls += 1;
        return "preview";
      },
      leaseOneJob: async (_owner, _now, guard) => {
        guard();
        return null;
      },
    });
    const marker = process.env.DEALER_STOCK_DESKTOP_API_ONLY;
    expect(await guarded.post({ op: "lease" })).toEqual({ ok: true, status: 200, body: { job: null } });
    expect(guardCalls).toBe(2);
    expect(process.env.DEALER_STOCK_DESKTOP_API_ONLY).toBe(marker);
    expect(guarded.env.DEALER_STOCK_DESKTOP_API_ONLY).toBe("1");
  });
});

function leasedJob(response: DesktopJobResponse): { id: string; kind: "SCRAPE" | "APPLY"; registryKey: string; leaseToken: string } {
  if (!response.ok || !("job" in response.body) || !response.body.job) throw new Error("lease was empty");
  return response.body.job;
}

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { DesktopPrincipal } from "@/lib/dealer-stock-sync/desktop-service";
import { DesktopSubmissionError, parseDesktopScrapeSubmission } from "@/lib/dealer-stock-sync/desktop-inventory";
import { getDealerStockRegistryOption } from "@/lib/dealer-stock-sync/registry-catalog";
import type { PipelineResult } from "@/scripts/dealer-stock-sync/types";

/** Fifteen minutes, matching the existing stock-sync lease. */
export const DESKTOP_JOB_LEASE_MS = 15 * 60 * 1000;
/**
 * One scrape heartbeat per minute, plus a short burst of one-photo apply steps
 * (preview cap is eight) and the surrounding lease/submit/fail calls.
 */
export const DESKTOP_JOB_RATE_LIMIT = 60;
export const DESKTOP_JOB_RATE_WINDOW_SECONDS = 60;

const JOB_ID = /^[a-z0-9]{8,40}$/;
const LEASE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const SCRAPE_FAILURE_REASON = "source-failed";
const FAIL_REASONS = ["source_unavailable", "browser_failed", "timed_out", "incomplete"] as const;

const jobId = z.string().regex(JOB_ID);
const leaseToken = z.string().regex(LEASE_TOKEN);
const checkBody = z.object({ op: z.literal("check") }).strict();
const leaseBody = z.object({ op: z.literal("lease") }).strict();
const heartbeatBody = z.object({ op: z.literal("heartbeat"), jobId, leaseToken }).strict();
const submitBody = z.object({ op: z.literal("submit"), jobId, leaseToken, result: z.unknown() }).strict();
const failBody = z.object({
  op: z.literal("fail"),
  jobId,
  leaseToken,
  reason: z.enum(FAIL_REASONS),
}).strict();
const stepBody = z.object({ op: z.literal("step"), jobId, leaseToken }).strict();

export interface DesktopJobRecord {
  id: string;
  kind: "SCRAPE" | "APPLY";
  status: "QUEUED" | "LEASED" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  bindingId: string;
  dealerId: string;
  reportId: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  payload: unknown;
}

export interface DesktopBindingRecord {
  id: string;
  dealerId: string;
  registryKey: string;
  verifiedAt: Date | null;
}

export interface DesktopReportRecord {
  id: string;
  bindingId: string;
  dealerId: string;
  fingerprint: string;
  status: string;
  approvedById: string | null;
}

export interface DesktopJobLeaseWhere {
  id: string;
  status: "LEASED";
  leaseOwner: string;
  leaseExpiresAt: { gt: Date };
}

export interface DesktopJobLeasePatch {
  leaseOwner?: string;
  leaseExpiresAt?: Date | null;
  status?: "FAILED";
  finishedAt?: Date;
  error?: string;
}

export interface DesktopApplyStepInput {
  jobId: string;
  busyOwner: string;
  bindingId: string;
  dealerId: string;
  reportId: string | null;
}

export type DesktopApplyStepResult =
  | { outcome: "continue" }
  | { outcome: "succeeded" }
  | { outcome: "failed" }
  | { outcome: "unavailable" };

export interface DesktopFailScrapeInput {
  jobId: string;
  busyOwner: string;
  bindingId: string;
  dealerId: string;
  failureReason: string;
  registryKey: string;
  expiresAt: Date;
}

export type DesktopJobGuard = () => void;

export interface DesktopJobDependencies {
  env: Record<string, string | undefined>;
  now: () => Date;
  authorize: (
    authorization: string | null,
  ) => Promise<{ ok: true; principal: DesktopPrincipal } | DesktopJobFailure>;
  assertEnvironment: (env: Record<string, string | undefined>) => "preview" | "production" | "local";
  consumeRate: (bucket: string, limit: number, windowSeconds: number) => Promise<boolean>;
  randomBytes: (size: number) => Buffer;
  leaseOneJob: (
    owner: string,
    now: Date,
    guard: DesktopJobGuard,
  ) => Promise<{ id: string; owner: string } | null>;
  runLeasedJob: (
    lease: { id: string; owner: string },
    scrape: (registryKey: string) => Promise<PipelineResult>,
    upload: undefined,
    guard: DesktopJobGuard,
  ) => Promise<void>;
  jobs: {
    findById(id: string): Promise<DesktopJobRecord | null>;
    updateMany(args: { where: DesktopJobLeaseWhere; data: DesktopJobLeasePatch }): Promise<{ count: number }>;
  };
  bindings: { findById(id: string): Promise<DesktopBindingRecord | null> };
  reports: { findById(id: string): Promise<DesktopReportRecord | null> };
  readiness: () => Promise<boolean>;
  failScrape: (input: DesktopFailScrapeInput) => Promise<"failed" | "lost">;
  applyStep: (input: DesktopApplyStepInput, guard: DesktopJobGuard) => Promise<DesktopApplyStepResult>;
}

export interface DesktopJobFailure {
  ok: false;
  status: 400 | 401 | 403 | 409 | 429 | 503;
  error: "invalid_request" | "unauthorized" | "forbidden" | "conflict" | "rate_limited" | "unavailable";
}

export type DesktopJobSuccessBody =
  | { ready: true }
  | { job: { id: string; kind: "SCRAPE" | "APPLY"; registryKey: string; leaseToken: string } | null }
  | { status: "extended" | "continue" | "succeeded" | "failed" };

export interface DesktopJobSuccess {
  ok: true;
  status: 200;
  body: DesktopJobSuccessBody;
}

export type DesktopJobResponse = DesktopJobFailure | DesktopJobSuccess;

type Gated = { principal: DesktopPrincipal; guard: DesktopJobGuard };

export function desktopLeaseOwner(
  principal: Pick<DesktopPrincipal, "environment" | "adminId" | "deviceId">,
  token: string,
): string {
  const canonical = JSON.stringify([
    "desktop-lease-v1",
    principal.environment,
    principal.adminId,
    principal.deviceId,
    token,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

function failure(status: DesktopJobFailure["status"], error: DesktopJobFailure["error"]): DesktopJobFailure {
  return { ok: false, status, error };
}

function success(body: DesktopJobSuccessBody): DesktopJobSuccess {
  return { ok: true, status: 200, body };
}

function busyOwner(regularOwner: string, nonce: string): string {
  return createHash("sha256").update(JSON.stringify(["desktop-busy-v1", regularOwner, nonce])).digest("hex");
}

function payloadRegistry(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const key = (payload as { registryKey?: unknown }).registryKey;
  return typeof key === "string" ? key : null;
}

function trustedBinding(job: DesktopJobRecord, binding: DesktopBindingRecord | null): binding is DesktopBindingRecord {
  return Boolean(
    binding &&
    binding.id === job.bindingId &&
    binding.dealerId === job.dealerId &&
    binding.verifiedAt &&
    (job.kind !== "SCRAPE" || payloadRegistry(job.payload) === binding.registryKey) &&
    getDealerStockRegistryOption(binding.registryKey),
  );
}

function leaseActive(job: DesktopJobRecord, owner: string, now: Date): boolean {
  return job.status === "LEASED" &&
    job.leaseOwner === owner &&
    job.leaseExpiresAt !== null &&
    job.leaseExpiresAt.getTime() > now.getTime();
}

function parseOperation(body: unknown): z.infer<typeof submitBody> | z.infer<typeof failBody> | z.infer<typeof stepBody> | z.infer<typeof heartbeatBody> | z.infer<typeof leaseBody> | z.infer<typeof checkBody> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const op = (body as { op?: unknown }).op;
  const parsed = op === "check" ? checkBody.safeParse(body)
    : op === "lease" ? leaseBody.safeParse(body)
    : op === "heartbeat" ? heartbeatBody.safeParse(body)
    : op === "submit" ? submitBody.safeParse(body)
    : op === "fail" ? failBody.safeParse(body)
    : op === "step" ? stepBody.safeParse(body)
    : null;
  return parsed?.success ? parsed.data : null;
}

async function gate(deps: DesktopJobDependencies, authorization: string | null): Promise<Gated | DesktopJobFailure> {
  let auth: { ok: true; principal: DesktopPrincipal } | DesktopJobFailure;
  try {
    auth = await deps.authorize(authorization);
  } catch {
    return failure(503, "unavailable");
  }
  if (!auth.ok) return auth;
  if (deps.env.DEALER_STOCK_DESKTOP_API_ONLY !== "1") return failure(503, "unavailable");
  const principal = auth.principal;
  try {
    if (deps.assertEnvironment(deps.env) !== principal.environment) return failure(403, "forbidden");
  } catch {
    return failure(503, "unavailable");
  }
  try {
    const bucket = `desktop-jobs:${principal.environment}:${principal.deviceId}`;
    const allowed = await deps.consumeRate(bucket, DESKTOP_JOB_RATE_LIMIT, DESKTOP_JOB_RATE_WINDOW_SECONDS);
    if (!allowed) return failure(429, "rate_limited");
  } catch {
    return failure(503, "unavailable");
  }
  const guard = () => {
    const current = deps.assertEnvironment(deps.env);
    if (deps.env.DEALER_STOCK_DESKTOP_API_ONLY !== "1" || current !== principal.environment) throw new Error("Stock sync job failed.");
  };
  return { principal, guard };
}

async function readJob(deps: DesktopJobDependencies, id: string): Promise<DesktopJobRecord | null | "down"> {
  try {
    return await deps.jobs.findById(id);
  } catch {
    return "down";
  }
}

async function readBinding(deps: DesktopJobDependencies, id: string): Promise<DesktopBindingRecord | null | "down"> {
  try {
    return await deps.bindings.findById(id);
  } catch {
    return "down";
  }
}

function expiresAt(now: Date): Date {
  return new Date(now.getTime() + DESKTOP_JOB_LEASE_MS);
}

async function compareOwner(
  deps: DesktopJobDependencies,
  where: DesktopJobLeaseWhere,
  data: DesktopJobLeasePatch,
): Promise<boolean | "down"> {
  try {
    const updated = await deps.jobs.updateMany({ where, data });
    return updated.count === 1;
  } catch {
    return "down";
  }
}

async function claimBusy(
  deps: DesktopJobDependencies,
  jobId: string,
  regularOwner: string,
  nextOwner: string,
  now: Date,
): Promise<boolean | "down"> {
  return compareOwner(
    deps,
    { id: jobId, status: "LEASED", leaseOwner: regularOwner, leaseExpiresAt: { gt: now } },
    { leaseOwner: nextOwner, leaseExpiresAt: expiresAt(now) },
  );
}

async function restoreOwner(
  deps: DesktopJobDependencies,
  jobId: string,
  busy: string,
  regularOwner: string,
  now: Date,
): Promise<boolean | "down"> {
  return compareOwner(
    deps,
    { id: jobId, status: "LEASED", leaseOwner: busy, leaseExpiresAt: { gt: now } },
    { leaseOwner: regularOwner, leaseExpiresAt: expiresAt(now) },
  );
}

function receiptRejected(claimed: boolean | "down"): DesktopJobFailure | null {
  if (claimed === "down") return failure(503, "unavailable");
  if (!claimed) return failure(409, "conflict");
  return null;
}

async function check(deps: DesktopJobDependencies): Promise<DesktopJobResponse> {
  try {
    if (await deps.readiness()) return success({ ready: true });
  } catch {
    return failure(503, "unavailable");
  }
  return failure(503, "unavailable");
}

async function lease(
  deps: DesktopJobDependencies,
  principal: DesktopPrincipal,
  guard: DesktopJobGuard,
  now: Date,
): Promise<DesktopJobResponse> {
  const token = deps.randomBytes(32).toString("base64url");
  if (!LEASE_TOKEN.test(token)) return failure(503, "unavailable");
  const owner = desktopLeaseOwner(principal, token);
  let leased: { id: string; owner: string } | null;
  try {
    leased = await deps.leaseOneJob(owner, now, guard);
  } catch {
    return failure(503, "unavailable");
  }
  if (!leased) return success({ job: null });
  if (leased.owner !== owner) return failure(503, "unavailable");
  const job = await readJob(deps, leased.id);
  if (job === "down") return failure(503, "unavailable");
  if (!job || !leaseActive(job, owner, now)) return failure(503, "unavailable");
  const binding = await requireBinding(deps, job);
  if ("error" in binding) {
    if (binding.status === 409) {
      const current = deps.now();
      await compareOwner(deps,
        { id: job.id, status: "LEASED", leaseOwner: owner, leaseExpiresAt: { gt: current } },
        { status: "FAILED", leaseExpiresAt: null, finishedAt: current, error: "Stock sync job failed." },
      );
    }
    return failure(503, "unavailable");
  }
  return success({
    job: { id: job.id, kind: job.kind, registryKey: binding.registryKey, leaseToken: token },
  });
}

async function heartbeat(
  deps: DesktopJobDependencies,
  principal: DesktopPrincipal,
  body: z.infer<typeof heartbeatBody>,
): Promise<DesktopJobResponse> {
  const job = await readJob(deps, body.jobId);
  if (job === "down") return failure(503, "unavailable");
  const now = deps.now();
  const owner = desktopLeaseOwner(principal, body.leaseToken);
  if (!job || !leaseActive(job, owner, now)) return failure(409, "conflict");
  const extended = await compareOwner(
    deps,
    { id: job.id, status: "LEASED", leaseOwner: owner, leaseExpiresAt: { gt: now } },
    { leaseExpiresAt: expiresAt(now) },
  );
  const rejected = receiptRejected(extended);
  if (rejected) return rejected;
  return success({ status: "extended" });
}

async function ownedJob(
  deps: DesktopJobDependencies,
  principal: DesktopPrincipal,
  jobId: string,
  token: string,
  now: Date,
): Promise<{ job: DesktopJobRecord; owner: string } | DesktopJobFailure> {
  const job = await readJob(deps, jobId);
  if (job === "down") return failure(503, "unavailable");
  const owner = desktopLeaseOwner(principal, token);
  if (!job || !leaseActive(job, owner, now)) return failure(409, "conflict");
  return { job, owner };
}

async function requireBinding(
  deps: DesktopJobDependencies,
  job: DesktopJobRecord,
): Promise<DesktopBindingRecord | DesktopJobFailure> {
  const binding = await readBinding(deps, job.bindingId);
  if (binding === "down") return failure(503, "unavailable");
  if (!trustedBinding(job, binding)) return failure(409, "conflict");
  if (job.kind === "APPLY") {
    const payload = job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
      ? job.payload as { reportId?: unknown; fingerprint?: unknown } : null;
    if (!job.reportId || payload?.reportId !== job.reportId || typeof payload.fingerprint !== "string") {
      return failure(409, "conflict");
    }
    let report: DesktopReportRecord | null;
    try { report = await deps.reports.findById(job.reportId); }
    catch { return failure(503, "unavailable"); }
    if (!report || report.id !== job.reportId || report.bindingId !== job.bindingId ||
        report.dealerId !== job.dealerId || report.status !== "APPROVED" ||
        !report.approvedById || report.fingerprint !== payload.fingerprint) {
      return failure(409, "conflict");
    }
  }
  return binding;
}

function terminalStatus(job: DesktopJobRecord | null | "down", busy: string): DesktopJobResponse {
  if (job === "down") return failure(503, "unavailable");
  if (!job || job.leaseOwner !== busy) return failure(409, "conflict");
  if (job.status === "SUCCEEDED") return success({ status: "succeeded" });
  if (job.status === "FAILED") return success({ status: "failed" });
  return failure(409, "conflict");
}

async function submit(
  deps: DesktopJobDependencies,
  principal: DesktopPrincipal,
  guard: DesktopJobGuard,
  body: z.infer<typeof submitBody>,
  now: Date,
): Promise<DesktopJobResponse> {
  const owned = await ownedJob(deps, principal, body.jobId, body.leaseToken, now);
  if ("error" in owned) return owned;
  if (owned.job.kind !== "SCRAPE") return failure(409, "conflict");
  const binding = await requireBinding(deps, owned.job);
  if ("error" in binding) return binding;
  let parsed: PipelineResult;
  try {
    parsed = parseDesktopScrapeSubmission(binding.registryKey, body.result);
  } catch (error) {
    return error instanceof DesktopSubmissionError ? failure(400, "invalid_request") : failure(503, "unavailable");
  }
  const busy = busyOwner(owned.owner, deps.randomBytes(16).toString("base64url"));
  if (busy === owned.owner) return failure(503, "unavailable");
  const claimed = await claimBusy(deps, owned.job.id, owned.owner, busy, deps.now());
  const rejected = receiptRejected(claimed);
  if (rejected) return rejected;
  try {
    await deps.runLeasedJob({ id: owned.job.id, owner: busy }, async (registryKey) => {
      if (registryKey !== binding.registryKey) throw new Error("Stock sync job failed.");
      return parsed;
    }, undefined, guard);
  } catch {
    return failure(503, "unavailable");
  }
  return terminalStatus(await readJob(deps, owned.job.id), busy);
}

async function fail(
  deps: DesktopJobDependencies,
  principal: DesktopPrincipal,
  body: z.infer<typeof failBody>,
  now: Date,
): Promise<DesktopJobResponse> {
  const owned = await ownedJob(deps, principal, body.jobId, body.leaseToken, now);
  if ("error" in owned) return owned;
  if (owned.job.kind !== "SCRAPE") return failure(409, "conflict");
  const binding = await requireBinding(deps, owned.job);
  if ("error" in binding) return binding;
  const busy = busyOwner(owned.owner, deps.randomBytes(16).toString("base64url"));
  if (busy === owned.owner) return failure(503, "unavailable");
  const claimed = await claimBusy(deps, owned.job.id, owned.owner, busy, deps.now());
  const rejected = receiptRejected(claimed);
  if (rejected) return rejected;
  try {
    const outcome = await deps.failScrape({
      jobId: owned.job.id,
      busyOwner: busy,
      bindingId: binding.id,
      dealerId: owned.job.dealerId,
      failureReason: SCRAPE_FAILURE_REASON,
      registryKey: binding.registryKey,
      expiresAt: expiresAt(deps.now()),
    });
    if (outcome !== "failed") return failure(409, "conflict");
  } catch {
    return failure(503, "unavailable");
  }
  return terminalStatus(await readJob(deps, owned.job.id), busy);
}

async function step(
  deps: DesktopJobDependencies,
  principal: DesktopPrincipal,
  guard: DesktopJobGuard,
  body: z.infer<typeof stepBody>,
  now: Date,
): Promise<DesktopJobResponse> {
  const owned = await ownedJob(deps, principal, body.jobId, body.leaseToken, now);
  if ("error" in owned) return owned;
  if (owned.job.kind !== "APPLY") return failure(409, "conflict");
  const binding = await requireBinding(deps, owned.job);
  if ("error" in binding) return binding;
  const busy = busyOwner(owned.owner, deps.randomBytes(16).toString("base64url"));
  if (busy === owned.owner) return failure(503, "unavailable");
  const claimed = await claimBusy(deps, owned.job.id, owned.owner, busy, deps.now());
  const rejected = receiptRejected(claimed);
  if (rejected) return rejected;
  let outcome: DesktopApplyStepResult;
  try {
    outcome = await deps.applyStep({
      jobId: owned.job.id,
      busyOwner: busy,
      bindingId: binding.id,
      dealerId: owned.job.dealerId,
      reportId: owned.job.reportId,
    }, guard);
  } catch {
    return failure(503, "unavailable");
  }
  if (outcome.outcome === "unavailable") return failure(503, "unavailable");
  if (outcome.outcome === "continue") {
    const restored = await restoreOwner(deps, owned.job.id, busy, owned.owner, deps.now());
    const restoreRejected = receiptRejected(restored);
    if (restoreRejected) return restoreRejected;
    const current = await readJob(deps, owned.job.id);
    if (current === "down") return failure(503, "unavailable");
    if (!current || current.status !== "LEASED" || current.leaseOwner !== owned.owner) return failure(409, "conflict");
    return success({ status: "continue" });
  }
  const current = await readJob(deps, owned.job.id);
  if (current === "down") return failure(503, "unavailable");
  if (!current || current.leaseOwner !== busy) return failure(409, "conflict");
  if (outcome.outcome === "succeeded" && current.status === "SUCCEEDED") return success({ status: "succeeded" });
  if (outcome.outcome === "failed" && current.status === "FAILED") return success({ status: "failed" });
  return failure(409, "conflict");
}

export async function handleDesktopJob(
  deps: DesktopJobDependencies,
  input: { body: unknown; authorization: string | null },
): Promise<DesktopJobResponse> {
  const gated = await gate(deps, input.authorization);
  if ("error" in gated) return gated;
  const body = parseOperation(input.body);
  if (!body) return failure(400, "invalid_request");
  const now = deps.now();
  if (body.op === "check") return check(deps);
  if (body.op === "lease") return lease(deps, gated.principal, gated.guard, now);
  if (body.op === "heartbeat") return heartbeat(deps, gated.principal, body);
  if (body.op === "submit") return submit(deps, gated.principal, gated.guard, body, now);
  if (body.op === "fail") return fail(deps, gated.principal, body, now);
  return step(deps, gated.principal, gated.guard, body, now);
}

export function defaultJobRandomBytes(size: number): Buffer {
  return randomBytes(size);
}

import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { insertAdminAudit, insertStatusEvent } from "./audit";
import {
  fetchReleaseRefs,
  isAncestor,
  originRepository,
  readOriginUrl,
  type GitRunner,
} from "./git-policy";
import { selectIssuesForUpdate } from "./live-issues";
import { resolutionNote, sanitizeNextStep } from "./notes";
import { assertSnapshotTarget } from "./snapshot";
import { FIXERRORS_SAFETY_CONTRACT, type OpenIssueSnapshot, type PgClientLike } from "./types";

const GIT_SHA = /^[0-9a-f]{40}$/iu;
const RECURRENCE_NOTE = "The issue recurred after the production deployment. Re-export and repair the new occurrence.";

export type ReleaseContext = {
  safetyContract: string;
  snapshotId: string;
  snapshotChecksum: string;
  productionSha: string;
  stagingSha: string;
};

export type ReleaseManifest = ReleaseContext & {
  version: 1;
  clusterId: string;
  issueIds: string[];
  issueFingerprints: string[];
  clusterFingerprint: string;
  fixCommitSha: string;
  paths: string[];
  postFixBlobs: Record<string, string>;
  tests: string[];
  evidence: string;
  checksum: string;
};

export type VercelDeployment =
  | { ok: true; sha: string; completedAt: string; targetUrl: string }
  | { ok: false; reason: string };

export type ReleaseIssue = {
  issueId: string;
  fingerprint: string;
  lastSeenAt: string;
  status: string;
};

export type ReleaseVerification = {
  ok: boolean;
  applied: boolean;
  reason?: string;
  resolvable: string[];
  recurred: string[];
};

export function clusterFingerprint(issueFingerprints: string[]): string {
  return createHash("sha256").update([...issueFingerprints].sort().join("\n")).digest("hex");
}

export function sealReleaseManifest(input: Omit<ReleaseManifest, "checksum">): ReleaseManifest {
  return { ...input, checksum: sha256(canonicalRelease(input)) };
}

export function verifyReleaseManifest(manifest: ReleaseManifest): ReleaseManifest {
  if (manifest.version !== 1 || manifest.safetyContract !== FIXERRORS_SAFETY_CONTRACT) {
    throw new Error("Release manifest safety contract mismatch");
  }
  const { checksum, ...rest } = manifest;
  if (!checksum || sealReleaseManifest(rest).checksum !== checksum) {
    throw new Error("Release manifest checksum mismatch");
  }
  if (manifest.clusterFingerprint !== clusterFingerprint(manifest.issueFingerprints)) {
    throw new Error("Release manifest fingerprint does not match the signed issues");
  }
  for (const sha of [manifest.fixCommitSha, manifest.productionSha, manifest.stagingSha]) {
    if (!GIT_SHA.test(sha)) throw new Error("Release manifest commit SHAs are malformed");
  }
  return manifest;
}

export function readReleaseManifest(path: string): ReleaseManifest {
  return verifyReleaseManifest(JSON.parse(readFileSync(path, "utf8")) as ReleaseManifest);
}

export function parseVercelProductionStatus(payload: unknown, expectedSha: string): VercelDeployment {
  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: "Vercel deployment status was not returned" };
  }
  const record = payload as { sha?: unknown; statuses?: unknown };
  if (record.sha !== expectedSha) return { ok: false, reason: "Vercel status does not match origin/main" };
  if (!Array.isArray(record.statuses)) return { ok: false, reason: "Vercel deployment status is missing" };
  const vercel = record.statuses.find((status) => (
    !!status && typeof status === "object" && (status as { context?: unknown }).context === "Vercel"
  )) as { state?: unknown; description?: unknown; target_url?: unknown; updated_at?: unknown } | undefined;
  if (!vercel) return { ok: false, reason: "Vercel deployment status is missing" };
  if (vercel.state === "pending") return { ok: false, reason: "Vercel production deployment is pending" };
  if (vercel.state !== "success") return { ok: false, reason: "Vercel production deployment did not succeed" };
  if (!/completed/iu.test(String(vercel.description ?? ""))) {
    return { ok: false, reason: "Vercel production deployment is not complete" };
  }
  const targetUrl = String(vercel.target_url ?? "");
  if (!/^https:\/\/vercel\.com\//u.test(targetUrl)) {
    return { ok: false, reason: "Vercel deployment URL is missing" };
  }
  const completedAt = String(vercel.updated_at ?? "");
  if (Number.isNaN(new Date(completedAt).getTime())) {
    return { ok: false, reason: "Vercel deployment completion time is missing" };
  }
  return { ok: true, sha: expectedSha, completedAt, targetUrl };
}

export function assessProductionRelease(input: {
  manifest: ReleaseManifest;
  containedByStaging: boolean;
  containedByMain: boolean;
  mainSha: string;
  vercel: VercelDeployment;
  issues: ReleaseIssue[];
}): { ok: true; resolvable: string[]; recurred: ReleaseIssue[] } | { ok: false; reason: string } {
  if (!input.containedByStaging) return { ok: false, reason: "Fix commit is not contained in origin/staging" };
  if (!input.containedByMain) {
    return { ok: false, reason: "Fix commit is not contained in origin/main. Squash or rebase releases stay acknowledged." };
  }
  if (!input.vercel.ok) return input.vercel;
  if (input.vercel.sha !== input.mainSha) {
    return { ok: false, reason: "A newer origin/main commit is not verified by Vercel" };
  }
  const deployedAt = new Date(input.vercel.completedAt).getTime();
  const resolvable: string[] = [];
  const recurred: ReleaseIssue[] = [];
  for (const [index, issueId] of input.manifest.issueIds.entries()) {
    const live = input.issues.find((issue) => issue.issueId === issueId);
    const expectedFingerprint = input.manifest.issueFingerprints[index];
    if (!live || live.fingerprint !== expectedFingerprint) {
      return { ok: false, reason: `Issue ${issueId} no longer matches the signed fingerprint` };
    }
    if (live.status !== "OPEN" && live.status !== "ACKNOWLEDGED") {
      return { ok: false, reason: `Issue ${issueId} status is ${live.status}` };
    }
    if (new Date(live.lastSeenAt).getTime() > deployedAt) recurred.push(live);
    else resolvable.push(issueId);
  }
  return { ok: true, resolvable, recurred };
}

export async function readVercelProductionStatus(input: {
  owner: string;
  repo: string;
  sha: string;
  run?: (args: string[]) => { status: number | null; stdout: string };
}): Promise<VercelDeployment> {
  const result = (input.run ?? runGh)(["api", `repos/${input.owner}/${input.repo}/commits/${input.sha}/status`]);
  if (result.status !== 0) {
    return { ok: false, reason: "GitHub authentication failed or the Vercel status could not be read" };
  }
  try {
    return parseVercelProductionStatus(JSON.parse(result.stdout) as unknown, input.sha);
  } catch {
    return { ok: false, reason: "Vercel deployment status was not returned" };
  }
}

export async function verifyProductionRelease(input: {
  client: PgClientLike;
  snapshot: OpenIssueSnapshot;
  manifest: ReleaseManifest;
  databaseTargetFingerprint: string;
  apply: boolean;
  actorAdminId: string;
  cwd?: string;
  runGit?: GitRunner;
  deployment?: VercelDeployment;
  now?: Date;
}): Promise<ReleaseVerification> {
  const manifest = verifyReleaseManifest(input.manifest);
  assertSnapshotTarget(input.snapshot, input.databaseTargetFingerprint);
  if (manifest.snapshotId !== input.snapshot.snapshotId || manifest.snapshotChecksum !== input.snapshot.checksum) {
    throw new Error("Release manifest does not match the signed snapshot");
  }
  for (const [index, issueId] of manifest.issueIds.entries()) {
    const snapshotIssue = input.snapshot.issues.find((issue) => issue.id === issueId);
    if (!snapshotIssue || snapshotIssue.fingerprint !== manifest.issueFingerprints[index]) {
      throw new Error("Release manifest does not match the signed snapshot issues");
    }
  }

  const cwd = input.cwd ?? process.cwd();
  const git = input.runGit;
  const refs = fetchReleaseRefs(cwd, git);
  const deployment = input.deployment ?? await deploymentForMain(refs.productionSha, cwd, git);
  const containedByStaging = isAncestor(manifest.fixCommitSha, "origin/staging", cwd, git);
  const containedByMain = isAncestor(manifest.fixCommitSha, "origin/main", cwd, git);
  const releaseGate = assessProductionRelease({
    manifest,
    containedByStaging,
    containedByMain,
    mainSha: refs.productionSha,
    vercel: deployment,
    issues: manifest.issueIds.map((issueId, index) => ({
      issueId,
      fingerprint: manifest.issueFingerprints[index] ?? "",
      lastSeenAt: "1970-01-01T00:00:00.000Z",
      status: "ACKNOWLEDGED",
    })),
  });
  if (!releaseGate.ok) {
    return { ok: false, applied: false, reason: releaseGate.reason, resolvable: [], recurred: [] };
  }

  const now = input.now ?? new Date();
  await input.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const live = await selectIssuesForUpdate(input.client, manifest.issueIds);
    const checked = assessProductionRelease({
      manifest,
      containedByStaging,
      containedByMain,
      mainSha: refs.productionSha,
      vercel: deployment,
      issues: manifest.issueIds.map((issueId) => {
        const issue = live.get(issueId);
        return {
          issueId,
          fingerprint: issue?.fingerprint ?? "",
          lastSeenAt: issue?.lastSeenAt ?? "",
          status: issue?.status ?? "MISSING",
        };
      }),
    });
    if (!checked.ok) {
      await input.client.query("ROLLBACK");
      return { ok: false, applied: false, reason: checked.reason, resolvable: [], recurred: [] };
    }
    if (!input.apply) {
      await input.client.query("ROLLBACK");
      return {
        ok: true,
        applied: false,
        resolvable: checked.resolvable,
        recurred: checked.recurred.map((issue) => issue.issueId),
      };
    }
    if (!deployment.ok) throw new Error("Vercel deployment status is missing");
    await resolveDeployedIssues({
      client: input.client,
      issues: checked.resolvable.map((issueId) => {
        const issue = live.get(issueId);
        return { issueId, fingerprint: issue?.fingerprint ?? "", status: issue?.status ?? "ACKNOWLEDGED" };
      }),
      deployedAt: new Date(deployment.completedAt),
      evidence: "Vercel production deployment completed",
      actorAdminId: input.actorAdminId,
      snapshotId: input.snapshot.snapshotId,
      now,
    });
    await noteRecurredAfterDeploy({
      client: input.client,
      issues: checked.recurred,
      actorAdminId: input.actorAdminId,
      snapshotId: input.snapshot.snapshotId,
      now,
    });
    await input.client.query("COMMIT");
    return {
      ok: true,
      applied: true,
      resolvable: checked.resolvable,
      recurred: checked.recurred.map((issue) => issue.issueId),
    };
  } catch (error) {
    await input.client.query("ROLLBACK");
    throw error;
  }
}

export async function resolveDeployedIssues(input: {
  client: PgClientLike;
  issues: Array<{ issueId: string; fingerprint: string; status: string }>;
  deployedAt: Date;
  evidence: string;
  actorAdminId: string;
  snapshotId: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const runId = randomUUID();
  for (const issue of input.issues) {
    const update = await input.client.query(
      `UPDATE "MonitoringIssue"
       SET status = 'RESOLVED',
           "resolvedAt" = $2,
           "mutedUntil" = NULL,
           "acknowledgedAt" = NULL,
           "acknowledgedSeverity" = NULL,
           "updatedAt" = $2
       WHERE id = $1
         AND fingerprint = $3
         AND status IN ('OPEN', 'ACKNOWLEDGED')
         AND "lastSeenAt" <= $4::timestamptz`,
      [issue.issueId, now, issue.fingerprint, input.deployedAt.toISOString()],
    );
    if ((update.rowCount ?? 0) !== 1) {
      throw new Error(`Failed to resolve deployed issue ${issue.issueId}; transaction rolled back`);
    }
    await insertStatusEvent(input.client, {
      issueId: issue.issueId,
      fromStatus: issue.status,
      toStatus: "RESOLVED",
      notes: resolutionNote(runId, input.evidence),
      now,
    });
    await insertAdminAudit(input.client, {
      adminId: input.actorAdminId,
      action: "FIXERRORS_RESOLVE_MONITORING_ISSUE",
      issueId: issue.issueId,
      details: { runId, evidence: input.evidence, snapshotId: input.snapshotId, deployedAt: input.deployedAt.toISOString() },
      now,
    });
  }
}

export async function noteRecurredAfterDeploy(input: {
  client: PgClientLike;
  issues: ReleaseIssue[];
  actorAdminId: string;
  snapshotId: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const nextStep = sanitizeNextStep(RECURRENCE_NOTE);
  for (const issue of input.issues) {
    const update = await input.client.query(
      `UPDATE "MonitoringIssue"
       SET status = 'ACKNOWLEDGED', "updatedAt" = $2
       WHERE id = $1 AND fingerprint = $3 AND status IN ('OPEN', 'ACKNOWLEDGED')`,
      [issue.issueId, now, issue.fingerprint],
    );
    if ((update.rowCount ?? 0) !== 1) {
      throw new Error(`Failed to record post-deploy recurrence for ${issue.issueId}; transaction rolled back`);
    }
    await insertStatusEvent(input.client, {
      issueId: issue.issueId,
      fromStatus: issue.status,
      toStatus: "ACKNOWLEDGED",
      notes: nextStep,
      now,
    });
    await insertAdminAudit(input.client, {
      adminId: input.actorAdminId,
      action: "FIXERRORS_ACKNOWLEDGE_MONITORING_ISSUE",
      issueId: issue.issueId,
      details: { snapshotId: input.snapshotId, nextStep },
      now,
    });
  }
}

async function deploymentForMain(sha: string, cwd: string, run?: GitRunner): Promise<VercelDeployment> {
  const remote = originRepository(readOriginUrl(cwd, run));
  return readVercelProductionStatus({ owner: remote.owner, repo: remote.repo, sha });
}

function canonicalRelease(manifest: Omit<ReleaseManifest, "checksum">): string {
  const blobs = Object.fromEntries(Object.entries(manifest.postFixBlobs).sort(([left], [right]) => left.localeCompare(right)));
  return JSON.stringify({
    version: manifest.version,
    safetyContract: manifest.safetyContract,
    snapshotId: manifest.snapshotId,
    snapshotChecksum: manifest.snapshotChecksum,
    clusterId: manifest.clusterId,
    issueIds: [...manifest.issueIds].sort(),
    issueFingerprints: [...manifest.issueFingerprints].sort(),
    clusterFingerprint: manifest.clusterFingerprint,
    productionSha: manifest.productionSha,
    stagingSha: manifest.stagingSha,
    fixCommitSha: manifest.fixCommitSha,
    paths: [...manifest.paths].sort(),
    postFixBlobs: blobs,
    tests: [...manifest.tests].sort(),
    evidence: manifest.evidence,
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function runGh(args: string[]) {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  return { status: result.status, stdout: typeof result.stdout === "string" ? result.stdout : "" };
}

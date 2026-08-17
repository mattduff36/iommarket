import { getVercelBillingConfig } from "@/lib/costs/config";
import { parseFocusJsonl, type FocusChargeRow } from "@/lib/costs/focus";

export interface VercelProjectSummary {
  id: string;
  name: string;
}

export interface VercelDeploymentSummary {
  uid: string;
  projectId?: string;
  state?: string;
  readyState?: string;
  target?: string | null;
  createdAt?: number;
}

export class CostDeploymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CostDeploymentError";
  }
}

export type VerifiedDeployment =
  | {
      status: "production";
      uid: string;
      projectId: string;
    }
  | {
      status: "preview";
      uid: string;
      projectId: string;
    };

interface VercelDeploymentRecord {
  id?: string;
  uid?: string;
  url?: string;
  readyState?: string;
  state?: string;
  target?: string | null;
  projectId?: string;
  ownerId?: string;
  teamId?: string;
  project?: { id?: string };
  team?: { id?: string };
}

export function normalizeDeploymentUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new CostDeploymentError("Deployment URL is required.");
  }
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function deploymentUid(record: VercelDeploymentRecord): string | null {
  const uid = record.uid?.trim() || record.id?.trim();
  return uid || null;
}

function deploymentProjectId(record: VercelDeploymentRecord): string | null {
  return record.project?.id?.trim() || record.projectId?.trim() || null;
}

function deploymentTeamId(record: VercelDeploymentRecord): string | null {
  return record.team?.id?.trim() || record.teamId?.trim() || record.ownerId?.trim() || null;
}

export async function verifyProductionDeployment(input: {
  deploymentUrl: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<VerifiedDeployment> {
  const config = getVercelBillingConfig(input.env);
  const fetchImpl = input.fetchImpl ?? fetch;
  const deploymentUrl = normalizeDeploymentUrl(input.deploymentUrl);
  const hostname = new URL(deploymentUrl).hostname;
  const requestUrl = new URL(`https://api.vercel.com/v13/deployments/${encodeURIComponent(hostname)}`);
  requestUrl.searchParams.set("teamId", config.teamId);

  const response = await fetchImpl(requestUrl, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new CostDeploymentError("Deployment could not be verified.");
  }

  const record = (await response.json()) as VercelDeploymentRecord;
  const uid = deploymentUid(record);
  const projectId = deploymentProjectId(record);
  const teamId = deploymentTeamId(record);
  const readyState = record.readyState ?? record.state;
  if (!uid || !projectId || !teamId) {
    throw new CostDeploymentError("Deployment identity is incomplete.");
  }
  if (teamId !== config.teamId) {
    throw new CostDeploymentError("Deployment team does not match the cost ledger.");
  }
  if (projectId !== config.projectId) {
    throw new CostDeploymentError("Deployment project does not match the cost ledger.");
  }
  if (readyState !== "READY") {
    throw new CostDeploymentError("Deployment is not ready.");
  }
  if (record.target === "preview") {
    return { status: "preview", uid, projectId };
  }
  if (record.target !== "production") {
    throw new CostDeploymentError("Deployment target is not production.");
  }
  return { status: "production", uid, projectId };
}

async function vercelGet<T>(
  path: string,
  token: string,
  teamId: string,
): Promise<T> {
  const url = new URL(`https://api.vercel.com${path}`);
  if (!url.searchParams.has("teamId")) {
    url.searchParams.set("teamId", teamId);
  }
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Vercel API ${path} returned ${response.status}.`);
  }
  return (await response.json()) as T;
}

export async function fetchFocusCharges(input: {
  from: Date;
  to: Date;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<{ rows: Array<{ row: FocusChargeRow; rawIndex: number }>; quarantined: Array<{ reason: string; rawIndex: number }> }> {
  const config = getVercelBillingConfig(input.env);
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = new URL("https://api.vercel.com/v1/billing/charges");
  url.searchParams.set("from", input.from.toISOString());
  url.searchParams.set("to", input.to.toISOString());
  url.searchParams.set("teamId", config.teamId);

  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Vercel billing charges returned ${response.status}.`);
  }

  const parsed = parseFocusJsonl(await response.text());
  return {
    rows: parsed.filter((line) => line.ok).map((line) => ({
      row: line.row,
      rawIndex: line.rawIndex,
    })),
    quarantined: parsed
      .filter((line) => !line.ok)
      .map((line) => ({ reason: line.reason, rawIndex: line.rawIndex })),
  };
}

export async function listTeamProjects(
  env: NodeJS.ProcessEnv = process.env,
): Promise<VercelProjectSummary[]> {
  const config = getVercelBillingConfig(env);
  const projects: VercelProjectSummary[] = [];
  let until: number | undefined;

  for (let page = 0; page < 20; page += 1) {
    const search = new URLSearchParams({ teamId: config.teamId, limit: "100" });
    if (until) search.set("until", String(until));
    const body = await vercelGet<{
      projects?: Array<{ id: string; name: string; createdAt?: number }>;
      pagination?: { next?: number | null };
    }>(`/v9/projects?${search.toString()}`, config.token, config.teamId);

    const batch = body.projects ?? [];
    projects.push(...batch.map((project) => ({ id: project.id, name: project.name })));
    if (!body.pagination?.next || batch.length === 0) break;
    until = body.pagination.next;
  }

  return projects;
}

export async function projectHasProductionDeployment(input: {
  projectId: string;
  from: Date;
  to: Date;
  env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
  const config = getVercelBillingConfig(input.env);
  const search = new URLSearchParams({
    teamId: config.teamId,
    projectId: input.projectId,
    target: "production",
    limit: "20",
    until: String(input.to.getTime()),
  });
  const body = await vercelGet<{ deployments?: VercelDeploymentSummary[] }>(
    `/v6/deployments?${search.toString()}`,
    config.token,
    config.teamId,
  );
  return (body.deployments ?? []).some((deployment) => {
    const state = deployment.readyState ?? deployment.state;
    const createdAt = deployment.createdAt ?? 0;
    return (
      state === "READY" &&
      (deployment.target === "production" || !deployment.target) &&
      createdAt <= input.to.getTime()
    );
  });
}

export async function listActiveProductionProjectIds(input: {
  from: Date;
  to: Date;
  env?: NodeJS.ProcessEnv;
}): Promise<string[]> {
  const projects = await listTeamProjects(input.env);
  const active: string[] = [];
  for (const project of projects) {
    if (
      await projectHasProductionDeployment({
        projectId: project.id,
        from: input.from,
        to: input.to,
        env: input.env,
      })
    ) {
      active.push(project.id);
    }
  }
  return active.sort();
}

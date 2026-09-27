import type { CostDashboardDto } from "@/lib/costs/dto";

export async function fetchRemoteCostDashboard(
  origin: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CostDashboardDto> {
  const secret = env.COST_LEDGER_READ_SECRET?.trim();
  if (!secret) {
    throw new Error("The canonical ledger read credential is not configured.");
  }
  const response = await fetch(`${origin}/api/internal/cost-ledger`, {
    headers: { authorization: `Bearer ${secret}` },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("The canonical ledger is unavailable.");
  }
  const body = (await response.json()) as { data?: CostDashboardDto };
  if (!body.data) {
    throw new Error("The canonical ledger is unavailable.");
  }
  return body.data;
}

export interface RemoteCostRefreshResult {
  status: "succeeded" | "partial" | "locked" | "skipped" | "failed";
  message: string;
  caughtUp?: boolean;
  errorCode?: string;
  queryFrom?: string;
  queryTo?: string;
}

export async function requestRemoteCostRefresh(
  origin: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RemoteCostRefreshResult> {
  const secret = env.COST_LEDGER_REQUEST_SECRET?.trim();
  if (!secret) {
    throw new Error("The canonical ledger request credential is not configured.");
  }
  const response = await fetch(`${origin}/api/internal/cost-ledger/refresh`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: "{}",
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as {
    data?: RemoteCostRefreshResult;
    error?: string;
  } | null;
  if (response.status === 404) {
    throw new Error("The live provider refresh endpoint is not deployed.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("The live provider refresh is not authorized.");
  }
  if (response.status === 504) {
    throw new Error("The live provider refresh timed out.");
  }
  if (
    body?.data?.status &&
    (response.ok || body.data.status === "failed")
  ) {
    return body.data;
  }
  if (!response.ok || !body?.data?.status) {
    throw new Error(body?.error || "Provider refresh failed.");
  }
  return body.data;
}

export async function requestRemoteInvoice(
  origin: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ requestId: string }> {
  const secret = env.COST_LEDGER_REQUEST_SECRET?.trim();
  if (!secret) {
    throw new Error("The canonical ledger request credential is not configured.");
  }
  const response = await fetch(`${origin}/api/internal/cost-ledger/requests`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: "{}",
    cache: "no-store",
  });
  const body = (await response.json()) as { data?: { requestId: string }; error?: string };
  if (!response.ok || !body.data?.requestId) {
    throw new Error(body.error || "The live ledger could not accept the invoice request.");
  }
  return body.data;
}

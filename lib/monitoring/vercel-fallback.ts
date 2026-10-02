export type VercelFallbackStatus = "configured" | "missing" | "unknown";

export interface VercelAlertRule {
  type?: string;
  name?: string;
  enabled?: boolean;
}

export function interpretVercelAlertRules(rules: VercelAlertRule[]): VercelFallbackStatus {
  const configured = rules.some((rule) => {
    const label = `${rule.type ?? ""} ${rule.name ?? ""}`.toLowerCase();
    return rule.enabled !== false && /error|anomaly|runtime/.test(label);
  });
  return configured ? "configured" : "missing";
}

export async function checkVercelErrorAlerts(input: {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
} = {}): Promise<VercelFallbackStatus> {
  const env = input.env ?? process.env;
  if (env.VERCEL_OBSERVABILITY_ALERTS_CONFIGURED === "1") return "configured";
  const token = env.VERCEL_TOKEN || env.VERCEL_ACCESS_TOKEN;
  const projectId = env.VERCEL_PROJECT_ID;
  const teamId = env.VERCEL_ORG_ID || env.VERCEL_TEAM_ID;
  if (!token || !projectId || !teamId) return "unknown";

  const url = new URL(`https://api.vercel.com/v1/projects/${projectId}/alerts`);
  url.searchParams.set("teamId", teamId);
  try {
    const response = await (input.fetchImpl ?? fetch)(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return "unknown";
    const body = await response.json() as { rules?: VercelAlertRule[]; alerts?: VercelAlertRule[] };
    return interpretVercelAlertRules(body.rules ?? body.alerts ?? []);
  } catch {
    return "unknown";
  }
}

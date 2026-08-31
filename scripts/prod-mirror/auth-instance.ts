export type AuthInstancePlan =
  | { action: "preserve" }
  | { action: "rewrite"; to: string }
  | { action: "fail"; reason: string };

export function resolveAuthInstanceIdPlan(
  sourceInstanceId: string | null | undefined,
  destInstanceId: string | null | undefined,
): AuthInstancePlan {
  const dest = destInstanceId?.trim() || "";
  const source = sourceInstanceId?.trim() || "";
  if (!dest) {
    return { action: "fail", reason: "Destination auth instance_id could not be read." };
  }
  if (!source || source === dest) {
    return source === dest ? { action: "preserve" } : { action: "rewrite", to: dest };
  }
  return { action: "rewrite", to: dest };
}

export const AUTH_INSTANCE_REWRITE_SQL =
  "UPDATE auth.users SET instance_id = $1::uuid WHERE instance_id IS DISTINCT FROM $1::uuid";

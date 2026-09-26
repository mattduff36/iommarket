import { CostConfigError } from "@/lib/costs/config";
import type { RuntimeEnv } from "@/lib/runtime-env";

export function isCanonicalLedgerWriter(env: RuntimeEnv = process.env): boolean {
  if (env.COST_LEDGER_ROLE !== "canonical") return false;
  const actual = env.VERCEL_PROJECT_ID?.trim();
  if (!actual) return true;
  const expected = env.COST_CANONICAL_VERCEL_PROJECT_ID?.trim();
  return Boolean(expected) && expected === actual;
}

export function assertCanonicalLedgerWriter(env: RuntimeEnv = process.env): void {
  if (isCanonicalLedgerWriter(env)) return;
  throw new CostConfigError(
    "This deployment is not the canonical ledger writer. VERCEL_ENV is not used for that decision.",
  );
}

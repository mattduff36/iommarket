import { CostConfigError } from "@/lib/costs/config";
import { isCanonicalLedgerWriter } from "@/lib/costs/ledger-role";
import type { RuntimeEnv } from "@/lib/runtime-env";
import { accountsPreviewRequested, assertAccountsPreview } from "./accounts-preview";

export type LedgerAccess =
  | { mode: "local" }
  | { mode: "accounts-preview" }
  | { mode: "remote"; origin: string }
  | { mode: "unavailable"; reason: string };

export function assertNoDirectLedgerDatabase(env: RuntimeEnv = process.env): void {
  if (env.COST_LEDGER_DATABASE_URL?.trim()) {
    throw new CostConfigError(
      "COST_LEDGER_DATABASE_URL is not allowed. Use the canonical ledger API.",
    );
  }
}

export function resolveLedgerAccess(env: RuntimeEnv = process.env): LedgerAccess {
  if(accountsPreviewRequested(env)){
    try{assertAccountsPreview(env);return {mode:"accounts-preview"};}
    catch{return {mode:"unavailable",reason:"Accounts preview isolation could not be verified."};}
  }
  if (env.COST_LEDGER_DATABASE_URL?.trim()) {
    return {
      mode: "unavailable",
      reason: "Direct production ledger database access is disabled.",
    };
  }
  if (isCanonicalLedgerWriter(env)) {
    return { mode: "local" };
  }
  const origin = env.COST_LEDGER_ORIGIN?.trim().replace(/\/$/, "");
  if (!origin) {
    return {
      mode: "unavailable",
      reason: "This deployment is not the canonical ledger and no ledger API origin is configured.",
    };
  }
  return { mode: "remote", origin };
}


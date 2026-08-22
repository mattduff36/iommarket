import { FINALISE_CONTRACT, type FinaliseModeKey } from "./types";

export interface TrustedOperationalAction {
  id: FinaliseModeKey;
  contract: typeof FINALISE_CONTRACT;
  command: string;
  push: boolean;
  dbMutations: [];
  allowedEffects: string[];
}

const ACTIONS: Record<FinaliseModeKey, TrustedOperationalAction> = {
  finalise: {
    id: "finalise",
    contract: FINALISE_CONTRACT,
    command: "npm run finalise",
    push: false,
    dbMutations: [],
    allowedEffects: ["verify", "git-commit"],
  },
  fap: {
    id: "fap",
    contract: FINALISE_CONTRACT,
    command: "npm run finalise:push",
    push: true,
    dbMutations: [],
    allowedEffects: ["verify", "git-commit", "git-push"],
  },
  "finalise-full": {
    id: "finalise-full",
    contract: FINALISE_CONTRACT,
    command: "npm run finalise:full",
    push: false,
    dbMutations: [],
    allowedEffects: ["verify", "build", "git-commit"],
  },
  ffap: {
    id: "ffap",
    contract: FINALISE_CONTRACT,
    command: "npm run finalise:full:push",
    push: true,
    dbMutations: [],
    allowedEffects: ["verify", "build", "git-commit", "git-push"],
  },
};

export function getTrustedOperationalAction(id: FinaliseModeKey) {
  return ACTIONS[id];
}

export function listTrustedOperationalActions() {
  return Object.values(ACTIONS);
}

export function getFinaliseModeKey(options: { full: boolean; push: boolean }): FinaliseModeKey {
  if (options.full && options.push) return "ffap";
  if (options.full) return "finalise-full";
  if (options.push) return "fap";
  return "finalise";
}

export function getPushModeDescription(options: { full: boolean; push: boolean; dryRun: boolean }) {
  if (options.dryRun) return "dry-run";
  if (options.full && options.push) return "full + push";
  if (options.full) return "full";
  if (options.push) return "push";
  return "standard";
}

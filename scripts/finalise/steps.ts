import type { FinaliseTaskKey } from "./types";

export interface FinaliseVerifyStep {
  task: FinaliseTaskKey;
  args: string[];
  rendered: string;
  fullOnly?: boolean;
}

export const FINALISE_VERIFY_STEPS: FinaliseVerifyStep[] = [
  { task: "typecheck", args: ["run", "typecheck"], rendered: "npm run typecheck" },
  { task: "test-run", args: ["run", "test:run"], rendered: "npm run test:run" },
  { task: "lint", args: ["run", "lint"], rendered: "npm run lint", fullOnly: true },
  { task: "build", args: ["run", "build"], rendered: "npm run build", fullOnly: true },
];

export function getFinaliseVerifySteps(full: boolean) {
  return FINALISE_VERIFY_STEPS.filter((step) => full || !step.fullOnly);
}

export function getFinaliseRepairCommand(task: FinaliseTaskKey) {
  return FINALISE_VERIFY_STEPS.find((step) => step.task === task) ?? null;
}

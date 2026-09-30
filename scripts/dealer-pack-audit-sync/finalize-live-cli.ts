import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { parseArgValue } from "../prod-mirror/safety";
import {
  auditPlanPath,
  readFrozenPlan,
  writeFrozenPlan,
} from "./plan-file";
import { liveVisualReportPaths } from "./live-visual";
import { assertPlanIntegrity } from "./plan-file";
import {
  assertFinalizedPreviewPlan,
  assertProductionLiveExclusionsProvenance,
  finalizePreviewPlanFromLiveVisual,
  liveExclusionsFromFinalPreviewPlan,
  parseProductionLiveExclusionsDocument,
  productionLiveGateFromFinalPreviewPlan,
  type ProductionLiveExclusion,
  type ProductionLiveGate,
} from "./finalize-live";
import { parseLiveVisualReport, type LiveVisualReport } from "./live-types";
import type { PreviewPackAuditPlan } from "./types";

const finalizeLiveArgsSchema = z
  .object({
    candidateRun: z.string().min(1).optional(),
    plan: z.string().min(1).optional(),
    report: z.string().min(1).optional(),
    finalRun: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.candidateRun || value.plan), {
    message: "--candidate-run or --plan is required.",
  })
  .refine((value) => Boolean(value.finalRun), {
    message: "--final-run is required.",
  });

export interface FinalizeLiveCliArgs {
  candidateRun?: string;
  plan?: string;
  report?: string;
  finalRun: string;
}

export interface FinalizeLiveWrittenPaths {
  planPath: string;
  exclusionsPath: string;
}

export interface FinalizeLiveCliDeps {
  cwd?: string;
  readPlan?: (path: string) => Promise<PreviewPackAuditPlan>;
  readReport?: (path: string) => Promise<LiveVisualReport>;
  writePlan?: (path: string, plan: PreviewPackAuditPlan) => Promise<void>;
  writeExclusions?: (path: string, value: unknown) => Promise<void>;
  now?: () => string;
}

export function parseFinalizeLiveArgs(argv: string[]): FinalizeLiveCliArgs {
  const parsed = finalizeLiveArgsSchema.parse({
    candidateRun: parseArgValue(argv, "candidate-run"),
    plan: parseArgValue(argv, "plan"),
    report: parseArgValue(argv, "report"),
    finalRun: parseArgValue(argv, "final-run"),
  });
  return {
    ...parsed,
    finalRun: parsed.finalRun!,
  };
}

export function finalizeLiveOutputPaths(finalRunId: string, cwd = process.cwd()) {
  return {
    planPath: auditPlanPath(finalRunId, cwd),
    exclusionsPath: resolve(
      dirname(auditPlanPath(finalRunId, cwd)),
      "live-exclusions.json",
    ),
  };
}

async function readLiveVisualReportFile(path: string): Promise<LiveVisualReport> {
  return parseLiveVisualReport(JSON.parse(await readFile(path, "utf8")));
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

export async function runFinalizeLiveCli(
  argv: string[] = process.argv.slice(2),
  deps: FinalizeLiveCliDeps = {},
) {
  const args = parseFinalizeLiveArgs(argv);
  const cwd = deps.cwd ?? process.cwd();
  const candidatePlanPath = args.plan
    ? resolve(cwd, args.plan)
    : auditPlanPath(args.candidateRun ?? "", cwd);
  const reportPath = args.report
    ? resolve(cwd, args.report)
    : liveVisualReportPaths(args.candidateRun ?? "", cwd).jsonPath;
  const candidate = await (deps.readPlan ?? readFrozenPlan)(candidatePlanPath);
  if (args.candidateRun && candidate.runId !== args.candidateRun) {
    throw new Error("Frozen candidate preview plan run ID mismatch.");
  }
  const report = await (deps.readReport ?? readLiveVisualReportFile)(reportPath);
  const finalPlan = finalizePreviewPlanFromLiveVisual({
    candidate,
    report,
    finalRunId: args.finalRun,
    createdAt: deps.now?.(),
  });
  const paths = finalizeLiveOutputPaths(finalPlan.runId, cwd);
  await (deps.writePlan ?? writeFrozenPlan)(paths.planPath, finalPlan);
  const exclusions = liveExclusionsFromFinalPreviewPlan(finalPlan);
  await (deps.writeExclusions ?? writeJson)(paths.exclusionsPath, {
    candidateRunId: candidate.runId,
    candidateFingerprint: candidate.fingerprint,
    finalRunId: finalPlan.runId,
    finalFingerprint: finalPlan.fingerprint,
    exclusions,
  });
  return { plan: finalPlan, paths, exclusions };
}

function isNotFoundError(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT",
  );
}

export interface ProductionLiveCliLoad {
  finalPlan: PreviewPackAuditPlan;
  exclusions: ProductionLiveExclusion[];
  gate: ProductionLiveGate;
}

export async function loadCliProductionLiveExclusions(input: {
  argv: string[];
  cwd?: string;
  readText?: (path: string) => Promise<string>;
  readPlan?: (path: string) => Promise<PreviewPackAuditPlan>;
}): Promise<ProductionLiveCliLoad> {
  const cwd = input.cwd ?? process.cwd();
  const liveRun = parseArgValue(input.argv, "live-run");
  const livePlan = parseArgValue(input.argv, "live-plan");
  const exclusionsArg = parseArgValue(input.argv, "live-exclusions");
  if (!liveRun && !livePlan) {
    throw new Error(
      "Refusing production plan: --live-run or a sealed finalized preview plan is required.",
    );
  }

  const planPath = livePlan
    ? resolve(cwd, livePlan)
    : auditPlanPath(liveRun ?? "", cwd);
  const finalPlan = await (input.readPlan ?? readFrozenPlan)(planPath);
  assertPlanIntegrity(finalPlan);
  assertFinalizedPreviewPlan(finalPlan);
  if (liveRun && finalPlan.runId !== liveRun) {
    throw new Error(
      "Refusing production live exclusions: --live-run does not match the finalized preview plan.",
    );
  }

  const derived = liveExclusionsFromFinalPreviewPlan(finalPlan);
  const sidecarPath = exclusionsArg
    ? resolve(cwd, exclusionsArg)
    : liveRun
      ? finalizeLiveOutputPaths(liveRun, cwd).exclusionsPath
      : null;
  if (sidecarPath) {
    try {
      const raw = JSON.parse(
        await (input.readText ?? readFileAsText)(sidecarPath),
      ) as unknown;
      const document = parseProductionLiveExclusionsDocument(raw);
      if (liveRun && document.finalRunId !== liveRun) {
        throw new Error(
          "Refusing production live exclusions: --live-run does not match the exclusions document.",
        );
      }
      assertProductionLiveExclusionsProvenance({ document, finalPlan });
    } catch (error) {
      if (exclusionsArg || !isNotFoundError(error)) throw error;
    }
  }

  return {
    finalPlan,
    exclusions: derived,
    gate: productionLiveGateFromFinalPreviewPlan(finalPlan),
  };
}

async function readFileAsText(path: string) {
  return readFile(path, "utf8");
}

if (process.argv[1]?.includes("finalize-live")) {
  runFinalizeLiveCli().then(({ plan, paths }) => {
    process.stdout.write(
      `Finalized ${plan.actionCount} preview pack action(s) at ${paths.planPath}\n` +
        `fingerprint=${plan.fingerprint}\n`,
    );
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { parseArgValue } from "../prod-mirror/safety";
import {
  auditPlanPath,
  auditRunDir,
  readFrozenPlan,
} from "./plan-file";
import { createPlaywrightLiveBrowser } from "./live-browser";
import { renderLiveVisualReport } from "./live-report";
import { safeFetchRemoteImage } from "./live-quality";
import {
  runLiveVisualValidation,
  type LiveEvidenceStore,
  type LiveValidateDeps,
} from "./live-validate";
import type { LiveVisualReport } from "./live-types";
import type { PreviewPackAuditPlan } from "./types";

export { runLiveVisualValidation } from "./live-validate";
export type { LiveVisualReport } from "./live-types";

const liveVisualArgsSchema = z
  .object({
    runId: z.string().min(1).optional(),
    plan: z.string().min(1).optional(),
    dealer: z.string().min(1).optional(),
    headed: z.boolean(),
  })
  .refine((value) => Boolean(value.runId || value.plan), {
    message: "--run-id or --plan is required.",
  });

export interface LiveVisualCliArgs {
  runId?: string;
  plan?: string;
  dealer?: string;
  headed: boolean;
}

export interface LiveVisualWrittenReports {
  jsonPath: string;
  markdownPath: string;
}

export interface LiveVisualCliDeps {
  cwd?: string;
  readPlan?: (path: string) => Promise<PreviewPackAuditPlan>;
  validate?: typeof runLiveVisualValidation;
  writeReports?: (
    report: LiveVisualReport,
    paths: LiveVisualWrittenReports,
  ) => Promise<LiveVisualWrittenReports>;
  createBrowser?: LiveValidateDeps["browser"];
  fetchImage?: LiveValidateDeps["fetchImage"];
  evidence?: LiveEvidenceStore;
  now?: () => string;
}

export function parseLiveVisualArgs(argv: string[]): LiveVisualCliArgs {
  return liveVisualArgsSchema.parse({
    runId: parseArgValue(argv, "run-id"),
    plan: parseArgValue(argv, "plan"),
    dealer: parseArgValue(argv, "dealer"),
    headed: argv.includes("--headed"),
  });
}

export function liveVisualReportPaths(runId: string, cwd = process.cwd()) {
  const dir = auditRunDir(runId, cwd);
  return {
    jsonPath: resolve(dir, "live-visual-report.json"),
    markdownPath: resolve(dir, "live-visual-report.md"),
  };
}

export function createFsEvidenceStore(runId: string, cwd = process.cwd()): LiveEvidenceStore {
  const root = auditRunDir(runId, cwd);
  return {
    async write(relPath: string, contents: Buffer | string) {
      const path = resolve(root, relPath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, contents, { flag: "wx" });
      return relPath.replace(/\\/g, "/");
    },
  };
}

async function writeLiveVisualReports(
  report: LiveVisualReport,
  paths: LiveVisualWrittenReports,
) {
  await mkdir(dirname(paths.jsonPath), { recursive: true });
  await writeFile(paths.jsonPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await writeFile(paths.markdownPath, renderLiveVisualReport(report), {
    encoding: "utf8",
    flag: "wx",
  });
  return paths;
}

export async function runLiveVisualCli(
  argv: string[] = process.argv.slice(2),
  deps: LiveVisualCliDeps = {},
): Promise<LiveVisualReport> {
  const args = parseLiveVisualArgs(argv);
  const cwd = deps.cwd ?? process.cwd();
  const planPath = args.plan
    ? resolve(cwd, args.plan)
    : auditPlanPath(args.runId ?? "", cwd);
  const plan = await (deps.readPlan ?? readFrozenPlan)(planPath);
  if (args.runId && plan.runId !== args.runId) {
    throw new Error("Frozen preview plan run ID mismatch.");
  }
  const report = await (deps.validate ?? runLiveVisualValidation)({
    plan,
    dealerKey: args.dealer,
    deps: {
      browser:
        deps.createBrowser ??
        (() => createPlaywrightLiveBrowser({ headed: args.headed })),
      fetchImage:
        deps.fetchImage ??
        ((url) => safeFetchRemoteImage(url)),
      evidence: deps.evidence ?? createFsEvidenceStore(plan.runId, cwd),
      now: deps.now,
    },
  });
  const paths = liveVisualReportPaths(plan.runId, cwd);
  await (deps.writeReports ?? writeLiveVisualReports)(report, paths);
  return report;
}

if (process.argv[1]?.includes("live-visual")) {
  runLiveVisualCli().then((report) => {
    process.stdout.write(
      `Live visual audit ${report.ok ? "PASS" : "FAIL"}; hidePacks=${report.hidePackCount}\n`,
    );
    if (!report.ok) process.exitCode = 1;
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

/**
 * Local verify-then-commit handoff.
 *
 * npm run finalise
 * npm run finalise:push
 * npm run finalise:full
 * npm run finalise:full:push
 *
 * Does not apply Prisma/Supabase migrations, bump a release version, or mutate a database.
 */
import { assertNoBlockingCursorActivity } from "./finalise/activity-guard";
import { clearFinaliseFailureArtifact, writeFinaliseFailureArtifact } from "./finalise/failure";
import {
  commitAllChanges,
  getChangedFileStats,
  getCurrentBranch,
  getUnmergedFiles,
  hasUncommittedChanges,
  pushCurrentBranch,
  runCommand,
} from "./finalise/git";
import { getFinaliseVerifySteps } from "./finalise/steps";
import { summarizeFinaliseChanges } from "./finalise/summary";
import { getFinaliseModeKey, getPushModeDescription, getTrustedOperationalAction } from "./finalise/trusted-actions";
import type { FinaliseOptions, FinaliseTaskKey } from "./finalise/types";

const REPO_ROOT = process.cwd();

function parseArgs(argv: string[]): FinaliseOptions {
  const args = new Set(argv);
  return {
    full: args.has("--full"),
    push: args.has("--push"),
    dryRun: args.has("--dry-run"),
    help: args.has("--help") || args.has("-h"),
  };
}

function printHelp() {
  process.stdout.write(`Usage: npx tsx scripts/finalise.ts [--full] [--push] [--dry-run]

Variants:
  --full     Also run lint and a production build
  --push     Push the current branch after commit
  --dry-run  Print the planned actions without changing anything

This command never applies migrations or writes to the database.
`);
}

function commandFor(task: FinaliseTaskKey) {
  const step = getFinaliseVerifySteps(true).find((item) => item.task === task);
  return step?.rendered ?? task;
}

function runDeterministicStep(params: {
  mode: ReturnType<typeof getFinaliseModeKey>;
  task: FinaliseTaskKey;
  action: () => void;
}) {
  try {
    params.action();
  } catch (error) {
    writeFinaliseFailureArtifact({
      repoRoot: REPO_ROOT,
      originalMode: params.mode,
      failedStep: params.task,
      command: commandFor(params.task),
    });
    throw error;
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const mode = getFinaliseModeKey(options);
  const trusted = getTrustedOperationalAction(mode);

  if (options.help) {
    printHelp();
    return;
  }

  assertNoBlockingCursorActivity(
    REPO_ROOT,
    [process.pid, process.ppid].filter((pid): pid is number => Number.isFinite(pid)),
    { ignoreFinalise: options.dryRun },
  );

  const unmergedFiles = getUnmergedFiles(REPO_ROOT);
  if (unmergedFiles.length > 0) {
    throw new Error(`Resolve merge conflicts before finalising: ${unmergedFiles.join(", ")}`);
  }

  const changedFileStats = getChangedFileStats(REPO_ROOT);
  const changeSummary = summarizeFinaliseChanges(changedFileStats);
  if (changeSummary.secretFiles.length > 0) {
    throw new Error(`Refuse to finalise with secret-like files: ${changeSummary.secretFiles.join(", ")}`);
  }

  const branch = getCurrentBranch(REPO_ROOT);
  const steps = getFinaliseVerifySteps(options.full);

  if (options.dryRun) {
    process.stdout.write(`Mode: ${getPushModeDescription(options)}\n`);
    process.stdout.write(`Trusted action: ${trusted.id} (${trusted.contract})\n`);
    process.stdout.write(`Branch: ${branch || "(detached HEAD)"}\n`);
    process.stdout.write(`Database mutations: none\n`);
    process.stdout.write(`Verify: ${steps.map((step) => commandFor(step.task)).join(", ")}\n`);
    if (changeSummary.schemaFiles.length > 0) {
      process.stdout.write(
        `Schema files changed (not applied): ${changeSummary.schemaFiles.join(", ")}. Use npm run db:migrate separately.\n`,
      );
    }
    process.stdout.write(
      `Commit: ${
        hasUncommittedChanges(REPO_ROOT)
          ? `would commit ${changeSummary.fileCount} file(s) with "${changeSummary.commitMessage}"`
          : "no changes to commit"
      }\n`,
    );
    process.stdout.write(`Push: ${options.push ? "would push current branch" : "skipped"}\n`);
    return;
  }

  process.stdout.write(`Starting finalise workflow (${getPushModeDescription(options)})\n`);
  process.stdout.write(`Trusted action: ${trusted.id} (${trusted.contract})\n`);

  for (const step of steps) {
    process.stdout.write(`\n==> ${commandFor(step.task)}\n`);
    runDeterministicStep({
      mode,
      task: step.task,
      action: () => runCommand(REPO_ROOT, "npm", step.args),
    });
  }

  if (changeSummary.schemaFiles.length > 0) {
    process.stdout.write(
      `\nSchema files changed but were not applied: ${changeSummary.schemaFiles.join(", ")}.\nApply with npm run db:migrate when you intend to change the database.\n`,
    );
  }

  process.stdout.write("\n==> Commit workspace changes\n");
  const committed = commitAllChanges(REPO_ROOT, changeSummary.commitMessage);
  process.stdout.write(
    committed ? `Created commit: ${changeSummary.commitMessage}\n` : "No uncommitted changes, so no commit was created.\n",
  );

  let pushedBranch: string | null = null;
  if (options.push) {
    process.stdout.write("\n==> Push current branch\n");
    pushedBranch = pushCurrentBranch(REPO_ROOT);
    process.stdout.write(`Pushed ${pushedBranch}.\n`);
  }

  clearFinaliseFailureArtifact(REPO_ROOT);
  process.stdout.write("\nFinalise complete.\n");
  process.stdout.write(`- Branch: ${branch || "(detached HEAD)"}\n`);
  process.stdout.write(`- Verify: passed\n`);
  process.stdout.write(`- Commit: ${committed ? "created" : "skipped"}\n`);
  process.stdout.write(`- Push: ${pushedBranch ? `pushed ${pushedBranch}` : "skipped"}\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\nFinalise failed: ${message}\n`);
  process.exit(1);
}

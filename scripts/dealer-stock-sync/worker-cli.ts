import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertWorkerEnabled } from "../../lib/dealer-stock-sync/worker-guard";

export function workerMode(argv: readonly string[]) {
  const once = argv.includes("--once");
  const watch = argv.includes("--watch");
  const manual = argv.includes("--manual");
  if (once === watch) return { error: "Pass exactly one of --once or --watch.\n" as const };
  return { once, manual };
}

export function readyLine(manual: boolean) {
  return manual
    ? "Dealer stock worker ready. Manual mode does not queue weekly scrapes.\n"
    : "Dealer stock worker ready.\n";
}

export function idleLine(manual: boolean) {
  return manual
    ? "Waiting for a queued job. Weekly scrapes stay off.\n"
    : "Waiting for a queued job.\n";
}

export function bindStop(write: (line: string) => void) {
  let stopped = false;
  let announced = false;
  return {
    isStopped: () => stopped,
    requestStop() {
      stopped = true;
      if (announced) return;
      announced = true;
      write("Stopping after the current job finishes.\n");
    },
  };
}

export async function processTick(input: {
  env: Record<string, string | undefined>;
  manual: boolean;
  isStopped: () => boolean;
  enqueueWeekly: () => Promise<unknown>;
  leaseOneJob: () => Promise<{ id: string; owner: string } | null>;
  runJob: (job: { id: string; owner: string }) => Promise<void>;
  write: (line: string) => void;
  authorise?: () => Promise<void>;
}): Promise<boolean> {
  if (input.isStopped()) return false;
  assertWorkerEnabled(input.env);
  await input.authorise?.();
  if (input.isStopped()) return false;
  if (!input.manual) await input.enqueueWeekly();
  if (input.isStopped()) return false;
  const job = await input.leaseOneJob();
  if (!job) return false;
  input.write(`Processing job ${job.id}.\n`);
  await input.runJob(job);
  input.write(`Finished processing job ${job.id}. Check its result in the admin page.\n`);
  return true;
}

export async function runWatchLoop(options: {
  manual: boolean;
  once: boolean;
  isStopped: () => boolean;
  tick: () => Promise<boolean>;
  pause: (ms: number) => Promise<void>;
  write: (line: string) => void;
}) {
  options.write(readyLine(options.manual));
  if (options.once) {
    await options.tick();
    options.write("Dealer stock worker finished.\n");
    return;
  }
  let idleAnnounced = false;
  while (!options.isStopped()) {
    const worked = await options.tick();
    if (options.isStopped()) break;
    if (worked) {
      idleAnnounced = false;
      continue;
    }
    if (!idleAnnounced) {
      options.write(idleLine(options.manual));
      idleAnnounced = true;
    }
    await options.pause(5_000);
  }
  options.write("Dealer stock worker stopped.\n");
}

async function pause(ms: number, isStopped: () => boolean) {
  let remaining = ms;
  while (remaining > 0 && !isStopped()) {
    const step = Math.min(200, remaining);
    await new Promise((resolve) => setTimeout(resolve, step));
    remaining -= step;
  }
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolve(entry) === resolve(fileURLToPath(import.meta.url));
}

export interface WorkerRuntimeOptions {
  authorise?: () => Promise<void>;
  isStopped?: () => boolean;
  write?: (line: string) => void;
}

export async function runWorker(
  argv: readonly string[] = process.argv.slice(2),
  options: WorkerRuntimeOptions = {},
) {
  const mode = workerMode(argv);
  if (mode.error) {
    process.stderr.write(mode.error);
    process.exitCode = 1;
    return;
  }
  assertWorkerEnabled(process.env);
  const { leaseOneJob, runLeasedJob } = await import("./execute-job");
  const { runDealerPipeline } = await import("./pipeline");
  const { getDealer } = await import("./registry");
  const { enqueueDueWeeklyScrapes } = await import("../../lib/dealer-stock-sync/enqueue");
  const { db } = await import("../../lib/db");
  const write = options.write ?? ((line: string) => { process.stdout.write(line); });
  const stop = bindStop(write);
  const isStopped = () => stop.isStopped() || options.isStopped?.() === true;
  const requestStop = () => stop.requestStop();
  process.on("SIGINT", requestStop);
  process.on("SIGTERM", requestStop);
  const stopOnInputEnd = () => stop.requestStop();
  if (mode.manual && !process.stdin.isTTY) {
    process.stdin.on("end", stopOnInputEnd);
    if (process.stdin.readableEnded || process.stdin.destroyed) stop.requestStop();
    process.stdin.resume();
  }
  try {
    await runWatchLoop({
      manual: mode.manual,
      once: mode.once,
      isStopped,
      write,
      pause: (ms) => pause(ms, isStopped),
      tick: () => processTick({
        env: process.env,
        manual: mode.manual,
        authorise: options.authorise,
        isStopped,
        enqueueWeekly: () => enqueueDueWeeklyScrapes(),
        leaseOneJob: () => leaseOneJob(),
        write,
        runJob: async (jobId) => {
          await runLeasedJob(jobId, async (registryKey) => {
            const dealer = getDealer(registryKey);
            return runDealerPipeline({
              ...dealer,
              sources: dealer.sources.map((source) => ({ ...source, headed: false })),
            });
          });
        },
      }),
    });
  } finally {
    process.off("SIGINT", requestStop);
    process.off("SIGTERM", requestStop);
    process.stdin.off("end", stopOnInputEnd);
    process.stdin.pause();
    await db.$disconnect();
  }
}

if (isDirectRun()) {
  runWorker().catch(() => {
    process.stderr.write("Stock worker stopped. Check the worker configuration and try again.\n");
    process.exitCode = 1;
  });
}

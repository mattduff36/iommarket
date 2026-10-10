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
}): Promise<boolean> {
  if (input.isStopped()) return false;
  assertWorkerEnabled(input.env);
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

async function main() {
  const mode = workerMode(process.argv.slice(2));
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
  const stop = bindStop((line) => process.stdout.write(line));
  process.on("SIGINT", () => stop.requestStop());
  process.on("SIGTERM", () => stop.requestStop());
  const stopOnInputEnd = () => stop.requestStop();
  if (mode.manual && !process.stdin.isTTY) {
    process.stdin.on("end", stopOnInputEnd);
    process.stdin.resume();
  }
  try {
    await runWatchLoop({
      manual: mode.manual,
      once: mode.once,
      isStopped: stop.isStopped,
      write: (line) => process.stdout.write(line),
      pause: (ms) => pause(ms, stop.isStopped),
      tick: () => processTick({
        env: process.env,
        manual: mode.manual,
        isStopped: stop.isStopped,
        enqueueWeekly: () => enqueueDueWeeklyScrapes(),
        leaseOneJob: () => leaseOneJob(),
        write: (line) => process.stdout.write(line),
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
    process.stdin.off("end", stopOnInputEnd);
    process.stdin.pause();
    await db.$disconnect();
  }
}

if (isDirectRun()) {
  main().catch(() => {
    process.stderr.write("Stock worker stopped. Check the worker configuration and try again.\n");
    process.exitCode = 1;
  });
}

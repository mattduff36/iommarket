import { assertWorkerEnabled } from "../../lib/dealer-stock-sync/worker-guard";

async function main() {
  assertWorkerEnabled(process.env);

  const once = process.argv.includes("--once");
  const watch = process.argv.includes("--watch");

  if (once === watch) {
    process.stderr.write("Pass exactly one of --once or --watch.\n");
    process.exit(1);
  }

  const { leaseOneJob, runLeasedJob } = await import("./execute-job");
  const { runDealerPipeline } = await import("./pipeline");
  const { getDealer } = await import("./registry");
  const { enqueueDueWeeklyScrapes } = await import("../../lib/dealer-stock-sync/enqueue");
  const { db } = await import("../../lib/db");

  let stopped = false;
  function requestStop() {
    stopped = true;
  }
  process.on("SIGINT", requestStop);
  process.on("SIGTERM", requestStop);

  async function pause(ms: number) {
    const step = 200;
    let remaining = ms;
    while (remaining > 0 && !stopped) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(step, remaining)));
      remaining -= step;
    }
  }

  async function tick() {
    assertWorkerEnabled(process.env);
    await enqueueDueWeeklyScrapes();
    const jobId = await leaseOneJob();
    if (!jobId) return false;
    await runLeasedJob(jobId, async (registryKey) => {
      const dealer = getDealer(registryKey);
      return runDealerPipeline({ ...dealer, sources: dealer.sources.map(source => ({ ...source, headed: false })) });
    });
    process.stdout.write(`dealer-stock-sync ${jobId.id}\n`);
    return true;
  }

  if (once) {
    await tick();
  } else {
    while (!stopped) {
      const worked = await tick();
      if (!worked) await pause(5_000);
    }
  }

  await db.$disconnect();
}
main().catch(() => { process.stderr.write("Stock worker stopped; verify environment settings and database availability.\n"); process.exitCode = 1; });

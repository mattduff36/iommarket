import { DesktopJobError, type DesktopJobsClient, type DesktopLease } from "./desktop-jobs-client";
import type { CanonicalVehicle, PipelineResult } from "./types";

export interface DesktopEvent {
  type: "status" | "job" | "error" | "check";
  state: string;
  message: string;
  jobId?: string;
}
const VEHICLE_FIELDS = [
  "dealerKey", "sourceKey", "platform", "sourceVehicleId", "registration", "vin", "stockReference",
  "make", "model", "derivative", "year", "firstRegistrationDate", "mileage", "pricePence", "isPoa",
  "fuel", "transmission", "bodyType", "colour", "doors", "seats", "engineSize", "enginePower", "vehicleType",
  "description", "locationName", "detailUrl", "availability", "sourceCreatedAt", "sourceUpdatedAt", "scrapedAt",
] as const satisfies readonly (keyof CanonicalVehicle)[];

/** Explicit raw projection; the server alone builds the review, fingerprint and plan. */
export function desktopScrapeSubmission(result: PipelineResult) {
  if (result.sourceResults.length > 20 || result.sourceResults.reduce((sum, source) => sum + source.vehicles.length, 0) > 2_000) {
    throw new DesktopJobError("invalid-request");
  }
  const sourceResults = result.sourceResults.map(source => ({
    dealerKey: source.dealerKey, sourceKey: source.sourceKey, platform: source.platform,
    status: source.status, error: source.error ? "The source did not complete." : null,
    startUrl: source.startUrl, pagesFetched: source.pagesFetched,
    advertisedCount: source.advertisedCount, rawCount: source.rawCount,
    // Missing completeness evidence remains missing: never fabricate a complete scrape.
    detailMissing: source.detailMissing, paginationUncertain: source.paginationUncertain,
    vehicles: source.vehicles.map(vehicle => ({
      ...Object.fromEntries(VEHICLE_FIELDS.map(key => [key, vehicle[key]])),
      imageUrls: vehicle.imageUrls.slice(0, 20),
      provenance: {
        startUrl: vehicle.provenance.startUrl,
        sourceKeys: [...vehicle.provenance.sourceKeys],
        rawIdentityHints: [...vehicle.provenance.rawIdentityHints],
      },
    })),
  }));
  const submission = { sourceResults, scrapeStartedAt: result.scrapeStartedAt, scrapeFinishedAt: result.scrapeFinishedAt };
  if (Buffer.byteLength(JSON.stringify(submission), "utf8") > 2 * 1024 * 1024 - 512) {
    throw new DesktopJobError("invalid-request");
  }
  return submission;
}

export interface DesktopWatchOptions {
  client: DesktopJobsClient;
  scrape: (registryKey: string) => Promise<PipelineResult>;
  isStopped: () => boolean;
  emit: (event: DesktopEvent) => void;
  wait?: (ms: number) => Promise<void>;
  heartbeatMs?: number;
}

/** A stop drains the one already leased job, including every approved photo step. */
export async function runDesktopWatch(options: DesktopWatchOptions): Promise<void> {
  const { client, scrape, isStopped, emit } = options;
  const wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const jobEvent = (job: DesktopLease, state: string, message: string) =>
    emit({ type: "job", state, message, jobId: job.id });

  async function scrapeJob(job: DesktopLease) {
    let pendingHeartbeat: Promise<void> | undefined;
    let heartbeatFailure: unknown;
    let heartbeatFailed = false;
    const timer = setInterval(() => {
      if (pendingHeartbeat || heartbeatFailed) return;
      pendingHeartbeat = client.heartbeat(job).catch(error => {
        heartbeatFailed = true;
        heartbeatFailure = error;
      }).finally(() => { pendingHeartbeat = undefined; });
    }, options.heartbeatMs ?? 60_000);
    let result: PipelineResult | undefined;
    try {
      try { result = await scrape(job.registryKey); }
      catch { /* Only a fixed failure reason may leave this process. */ }
    } finally {
      clearInterval(timer);
      await pendingHeartbeat;
    }
    // A lost heartbeat may already have extended the lease. Stop; do not guess or retry.
    if (heartbeatFailed) throw heartbeatFailure;
    if (!result) {
      await client.fail(job, "source_unavailable");
      throw new DesktopJobError("job-failed");
    }
    let submission: ReturnType<typeof desktopScrapeSubmission>;
    try { submission = desktopScrapeSubmission(result); }
    catch {
      await client.fail(job, "incomplete");
      throw new DesktopJobError("job-failed");
    }
    const status = await client.submit(job, submission);
    if (status !== "succeeded") throw new DesktopJobError("job-failed");
    jobEvent(job, "processing-finished", "The scan was processed. Check Stock Reviews for the report and any required approval.");
  }

  emit({ type: "status", state: "ready", message: "Manual worker ready. Already queued jobs may be processed." });
  while (!isStopped()) {
    const job = await client.lease(isStopped);
    if (!job) {
      if (isStopped()) break;
      emit({ type: "status", state: "waiting", message: "Waiting for queued jobs. Weekly scheduling is off." });
      // Keep idle safe-stop responsive without aborting an in-flight lease.
      for (let elapsed = 0; elapsed < 5_000 && !isStopped(); elapsed += 250) await wait(250);
      continue;
    }
    jobEvent(job, "processing", "Processing a queued stock job.");
    if (job.kind === "SCRAPE") await scrapeJob(job);
    else {
      jobEvent(job, "staging-photos", "The server is preparing approved photos and applying the reviewed report.");
      let result: Awaited<ReturnType<DesktopJobsClient["step"]>>;
      do { result = await client.step(job); } while (result === "continue");
      if (result !== "succeeded") throw new DesktopJobError("job-failed");
      jobEvent(job, "applied", "iTrader confirmed that the approved stock report was applied.");
    }
  }
  emit({ type: "status", state: "stopped", message: "Worker stopped. No further job will be taken." });
}

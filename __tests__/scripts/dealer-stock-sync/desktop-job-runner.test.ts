/* @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import { desktopScrapeSubmission, runDesktopWatch, type DesktopEvent } from "@/scripts/dealer-stock-sync/desktop-job-runner";
import { DesktopJobError, type DesktopLease } from "@/scripts/dealer-stock-sync/desktop-jobs-client";
import { getDealer } from "@/scripts/dealer-stock-sync/registry";
import type { CanonicalVehicle, PipelineResult } from "@/scripts/dealer-stock-sync/types";
import { parseDesktopScrapeSubmission } from "@/lib/dealer-stock-sync/desktop-inventory";

function pipeline(): PipelineResult {
  const dealer = getDealer("mikes-motors");
  const stamp = new Date().toISOString();
  const vehicle: CanonicalVehicle = {
    dealerKey: dealer.key, sourceKey: "used-cars", platform: "click-dealer", sourceVehicleId: "8324646",
    registration: "MNZ123A", vin: null, stockReference: null, make: "Ford", model: "Fiesta",
    derivative: null, year: 2019, firstRegistrationDate: null, mileage: 32000, pricePence: 899500,
    isPoa: false, fuel: "Petrol", transmission: "Manual", bodyType: "Hatchback", colour: "Blue",
    doors: 5, seats: 5, engineSize: 1.2, enginePower: 100, vehicleType: "car", description: "One owner.",
    locationName: null, detailUrl: "https://www.mikesmotors.im/used-cars/ford-fiesta-8324646",
    imageUrls: ["https://images.clickdealer.co.uk/vehicles/8324/8324646/full/204251334.jpg"],
    availability: "available", sourceCreatedAt: null, sourceUpdatedAt: null, scrapedAt: stamp,
    provenance: { startUrl: dealer.sources[0].startUrl, sourceKeys: ["used-cars"], rawIdentityHints: ["8324646"] },
  };
  return {
    dealer, reconciled: [], canArchive: false, scrapeStartedAt: stamp, scrapeFinishedAt: stamp,
    sourceResults: dealer.sources.map(source => ({
      dealerKey: dealer.key, sourceKey: source.key, platform: source.connectorKey, status: "ok",
      error: null, startUrl: source.startUrl, pagesFetched: 1, advertisedCount: source.key === "used-cars" ? 1 : 0,
      rawCount: source.key === "used-cars" ? 1 : 0, vehicles: source.key === "used-cars" ? [vehicle] : [],
      detailMissing: 0, paginationUncertain: false, rawRecords: [{ private: "must not travel" }],
    })),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function watch(kind: DesktopLease["kind"] = "SCRAPE") {
  let stopped = false;
  const job: DesktopLease = { id: "cmjob12345678", kind, registryKey: "mikes-motors", leaseToken: "l".repeat(43) };
  const events: DesktopEvent[] = [];
  const client = {
    check: vi.fn(async () => undefined),
    lease: vi.fn(async (_isStopped?: () => boolean) => { stopped = true; return job as DesktopLease | null; }),
    heartbeat: vi.fn(async (_job: DesktopLease): Promise<void> => undefined),
    submit: vi.fn(async (_job: DesktopLease, _result: unknown) => "succeeded" as "succeeded" | "failed"),
    fail: vi.fn(async (_job: DesktopLease, _reason: string) => "failed" as const),
    step: vi.fn(async (_job: DesktopLease) => "succeeded" as "continue" | "succeeded" | "failed"),
  };
  const options = {
    client, scrape: vi.fn(async (_key: string) => pipeline()), isStopped: () => stopped,
    emit: (event: DesktopEvent) => { events.push(event); }, wait: vi.fn(async (_ms: number) => undefined),
  };
  return { options, client, job, events, stop: () => { stopped = true; } };
}
afterEach(() => vi.useRealTimers());

describe("desktop raw submission", () => {
  it("projects only raw fields that the actual server validator accepts", () => {
    const result = pipeline();
    Object.assign(result, { plan: "untrusted", approved: true });
    Object.assign(result.sourceResults[0].vehicles[0], { localPath: "private", config: "private" });
    const body = desktopScrapeSubmission(result);
    expect(Object.keys(body).sort()).toEqual(["scrapeFinishedAt", "scrapeStartedAt", "sourceResults"]);
    expect(JSON.stringify(body)).not.toMatch(/must not travel|private|approved|reconciled|canArchive|localPath/);
    const accepted = parseDesktopScrapeSubmission("mikes-motors", body);
    expect(accepted.reconciled).toHaveLength(1);
    expect(accepted.canArchive).toBe(true);
  });
  it("caps source photos at twenty without deleting vehicles or inventing completeness", () => {
    const result = pipeline();
    const source = result.sourceResults[0];
    source.vehicles[0].imageUrls = Array.from({ length: 30 }, (_, i) => "https://images.clickdealer.co.uk/vehicles/8324/8324646/full/" + i + ".jpg");
    delete source.detailMissing; delete source.paginationUncertain;
    const body = desktopScrapeSubmission(result);
    expect(body.sourceResults[0].vehicles).toHaveLength(1);
    expect(body.sourceResults[0].vehicles[0].imageUrls).toHaveLength(20);
    expect(body.sourceResults[0].detailMissing).toBeUndefined();
    expect(body.sourceResults[0].paginationUncertain).toBeUndefined();
    expect(parseDesktopScrapeSubmission("mikes-motors", body).canArchive).toBe(false);
  });
  it("deduplicates repeated gallery photos before the photo limit and server validation", () => {
    const result = pipeline();
    const photos = Array.from({ length: 21 }, (_, i) => `https://images.clickdealer.co.uk/vehicles/8324/8324646/full/${i}.jpg`);
    result.sourceResults[0].vehicles[0].imageUrls = [photos[0], ...photos];
    const body = desktopScrapeSubmission(result);
    expect(body.sourceResults[0].vehicles[0].imageUrls).toEqual(photos.slice(0, 20));
    expect(() => parseDesktopScrapeSubmission("mikes-motors", body)).not.toThrow();
  });
  it("rejects oversize inventory or body and retains missing-photo evidence", () => {
    const result = pipeline();
    const vehicle = result.sourceResults[0].vehicles[0];
    vehicle.imageUrls = [];
    expect(desktopScrapeSubmission(result).sourceResults[0].vehicles[0].imageUrls).toEqual([]);
    result.sourceResults[0].vehicles = Array.from({ length: 2001 }, () => vehicle);
    expect(() => desktopScrapeSubmission(result)).toThrow(DesktopJobError);
    result.sourceResults[0].vehicles = [vehicle]; vehicle.description = "x".repeat(2 * 1024 * 1024);
    expect(() => desktopScrapeSubmission(result)).toThrow(DesktopJobError);
  });
});

describe("desktop manual loop", () => {
  it("continues after failed scrape and apply jobs to the remaining dealer", async () => {
    const f = watch();
    f.client.lease.mockReset();
    f.client.lease.mockResolvedValueOnce(f.job)
      .mockResolvedValueOnce({ ...f.job, id: "failed-apply", kind: "APPLY" })
      .mockResolvedValueOnce({ ...f.job, id: "next-dealer" }).mockResolvedValue(null);
    f.client.submit.mockResolvedValueOnce("failed").mockResolvedValueOnce("succeeded");
    f.client.step.mockResolvedValueOnce("failed");
    await runDesktopWatch(f.options);
    expect(f.client.lease).toHaveBeenCalledTimes(4);
    expect(f.events.filter(e => e.state === "job-failed")).toHaveLength(2);
    expect(f.events.find(e => e.jobId === "next-dealer" && e.state === "processing-finished")).toBeDefined();
    expect(f.events.at(-1)?.state).toBe("stopped");
  });
  it("drains queued jobs and stops automatically after the final job", async () => {
    const f = watch();
    f.client.lease.mockReset();
    f.client.lease.mockResolvedValueOnce(f.job).mockResolvedValueOnce({ ...f.job, id: "second-job" }).mockResolvedValue(null);
    await runDesktopWatch(f.options);
    expect(f.client.submit).toHaveBeenCalledTimes(2);
    expect(f.client.lease).toHaveBeenCalledTimes(3);
    expect(f.options.wait).not.toHaveBeenCalled();
    expect(f.events.at(-1)?.state).toBe("stopped");
  });
  it("takes no lease when already stopped", async () => {
    const f = watch(); f.stop(); await runDesktopWatch(f.options);
    expect(f.client.lease).not.toHaveBeenCalled();
  });
  it("drains a SCRAPE lease that arrives during safe stop and never claims applied", async () => {
    const f = watch(); await runDesktopWatch(f.options);
    expect(f.client.lease).toHaveBeenCalledTimes(1);
    expect(f.options.scrape).toHaveBeenCalledWith("mikes-motors");
    expect(f.client.submit).toHaveBeenCalledTimes(1);
    expect(f.events.map(e => e.state)).toContain("processing-finished");
    expect(f.events.map(e => e.state)).not.toContain("applied");
  });
  it("drains every APPLY step after stop, only emitting success at the terminal response", async () => {
    const f = watch("APPLY");
    f.client.step.mockResolvedValueOnce("continue").mockResolvedValueOnce("continue").mockResolvedValueOnce("succeeded");
    await runDesktopWatch(f.options);
    expect(f.client.step).toHaveBeenCalledTimes(3);
    expect(f.client.lease).toHaveBeenCalledTimes(1);
    expect(f.client.heartbeat).not.toHaveBeenCalled();
    expect(f.options.scrape).not.toHaveBeenCalled();
    expect(f.events.filter(e => e.state === "applied")).toHaveLength(1);
  });
  it("stops automatically when the queue is empty without submitting or polling", async () => {
    const f = watch();
    f.client.lease.mockResolvedValue(null);
    f.options.wait.mockImplementation(async () => { f.stop(); });
    await runDesktopWatch(f.options);
    expect(f.options.wait).not.toHaveBeenCalled();
    expect(f.events.at(-1)?.state).toBe("stopped");
    expect(f.client.lease).toHaveBeenCalledTimes(1);
    expect(f.client.submit).not.toHaveBeenCalled(); expect(f.client.step).not.toHaveBeenCalled();
  });
  it("records a generic scraper failure once and honours safe stop", async () => {
    const f = watch(); f.options.scrape.mockRejectedValue(new Error("private internal detail"));
    await expect(runDesktopWatch(f.options)).resolves.toBeUndefined();
    expect(f.client.fail).toHaveBeenCalledWith(f.job, "source_unavailable");
    expect(f.client.submit).not.toHaveBeenCalled(); expect(f.client.lease).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.events)).not.toContain("private");
  });
  it("fails an oversize local submission without silently truncating inventory", async () => {
    const f = watch(); const result = pipeline();
    result.sourceResults[0].vehicles = Array.from({ length: 2001 }, () => result.sourceResults[0].vehicles[0]);
    f.options.scrape.mockResolvedValue(result);
    await expect(runDesktopWatch(f.options)).resolves.toBeUndefined();
    expect(f.client.fail).toHaveBeenCalledWith(f.job, "incomplete");
    expect(f.client.submit).not.toHaveBeenCalled();
  });
  it("finishes a definitely rejected submission as failed without retrying or announcing success", async () => {
    const f = watch();
    f.client.submit.mockRejectedValue(new DesktopJobError("invalid-request"));
    await expect(runDesktopWatch(f.options)).resolves.toBeUndefined();
    expect(f.client.submit).toHaveBeenCalledTimes(1);
    expect(f.client.fail).toHaveBeenCalledWith(f.job, "incomplete");
    expect(f.client.lease).toHaveBeenCalledTimes(1);
    expect(f.events.some(event => event.state === "processing-finished")).toBe(false);
  });
  it.each(["submit", "step"] as const)("does not retry ambiguous %s or emit false success", async operation => {
    const f = watch(operation === "step" ? "APPLY" : "SCRAPE");
    f.client[operation].mockRejectedValue(new DesktopJobError("unavailable"));
    await expect(runDesktopWatch(f.options)).rejects.toMatchObject({ reason: "unavailable" });
    expect(f.client[operation]).toHaveBeenCalledTimes(1); expect(f.client.fail).not.toHaveBeenCalled();
    expect(f.events.some(e => e.state === "applied" || e.state === "processing-finished")).toBe(false);
  });
  it.each(["submit", "step"] as const)("records actual failed %s state without announcing success", async operation => {
    const f = watch(operation === "step" ? "APPLY" : "SCRAPE"); f.client[operation].mockResolvedValue("failed");
    await expect(runDesktopWatch(f.options)).resolves.toBeUndefined();
    expect(f.client.lease).toHaveBeenCalledTimes(1); expect(f.events.some(e => e.state === "applied")).toBe(false);
  });
  it("awaits the pending scrape heartbeat before submitting, even after safe stop", async () => {
    vi.useFakeTimers(); const f = watch(); const scrape = deferred<PipelineResult>(); const heartbeat = deferred<void>();
    f.options.scrape.mockReturnValue(scrape.promise); f.client.heartbeat.mockReturnValue(heartbeat.promise);
    const running = runDesktopWatch(f.options);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.client.heartbeat).toHaveBeenCalledTimes(1);
    scrape.resolve(pipeline()); await vi.advanceTimersByTimeAsync(0);
    expect(f.client.submit).not.toHaveBeenCalled();
    heartbeat.resolve(); await running; expect(f.client.submit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000); expect(f.client.heartbeat).toHaveBeenCalledTimes(1);
  });
  it("stops after a lost heartbeat without submit, fail, next lease or automatic retry", async () => {
    vi.useFakeTimers(); const f = watch(); const scrape = deferred<PipelineResult>();
    f.options.scrape.mockReturnValue(scrape.promise); f.client.heartbeat.mockRejectedValue(new DesktopJobError("unauthorised"));
    const running = runDesktopWatch(f.options); const rejected = expect(running).rejects.toMatchObject({ reason: "unauthorised" });
    await vi.advanceTimersByTimeAsync(180_000); scrape.resolve(pipeline()); await rejected;
    expect(f.client.heartbeat).toHaveBeenCalledTimes(1); expect(f.client.lease).toHaveBeenCalledTimes(1);
    expect(f.client.submit).not.toHaveBeenCalled(); expect(f.client.fail).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/monitoring/capture", () => ({ captureBusinessEvent: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
import { probePublicImage, runMediaHealthCheck } from "@/lib/monitoring/media-health";
import { captureBusinessEvent } from "@/lib/monitoring/capture";
import { checkRateLimit } from "@/lib/rate-limit";
import { redactMonitoringPayload } from "@/lib/monitoring/redact";

const home = () => new Response('<img src="/api/media/listing-photo?imageId=test&amp;source=listing&amp;mode=fill&amp;frame=card&amp;w=640">');
const redirect = (url = "https://ik.imagekit.io/example/photo") => new Response(null, { status: 302, headers: { location: url } });
const jpeg = () => new Response(new Uint8Array([255, 216, 255, ...Array(20).fill(0)]), { headers: { "content-type": "image/jpeg" } });
const brokenBody = () => new Response(new ReadableStream({
  start(controller) { controller.error(new Error("private body details")); },
}), { headers: { "content-type": "image/jpeg" } });
const unavailable = (status = 503) => new Response("private provider details", { status });

async function runScheduledProbe(request: ReturnType<typeof vi.fn>, origin = "https://itrader.im", rateUnavailable = false) {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: !rateUnavailable, unavailable: rateUnavailable, remaining: 0, resetAt: 60_000 });
  vi.stubGlobal("fetch", request);
  return runMediaHealthCheck();
}
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("scheduled image checks", () => {
  it("deduplicates within one UTC day and records failures on later days", async () => {
    const failedHome = vi.fn().mockImplementation(() => Promise.resolve(unavailable()));
    for (const at of ["2026-11-09T01:00:00Z", "2026-11-09T23:59:00Z", "2026-11-10T00:01:00Z"]) {
      vi.setSystemTime(new Date(at));
      await runScheduledProbe(failedHome);
    }
    expect(vi.mocked(captureBusinessEvent).mock.calls.map(([event]) => event.dedupeKey)).toEqual([
      "media-health:2026-11-09", "media-health:2026-11-09", "media-health:2026-11-10",
    ]);
  });
  it.each([
    { name: "homepage HTTP failure", responses: () => [unavailable()], phase: "homepage", reason: "http-status", status: 503 },
    { name: "homepage missing body", responses: () => [new Response(null)], phase: "homepage", reason: "missing-body", status: 200 },
    { name: "oversized homepage", responses: () => [new Response("x".repeat(2_000_001))], phase: "homepage", reason: "homepage-too-large", status: 200 },
    { name: "homepage without a photo", responses: () => [new Response("private homepage details")], phase: "homepage", reason: "photo-not-found", status: 200 },
    { name: "homepage read failure", responses: () => [brokenBody()], phase: "homepage", reason: "body-read-failed", status: 200 },
    { name: "listing endpoint failure", responses: () => [home(), unavailable(429)], phase: "listing-photo", reason: "http-status", status: 429 },
    { name: "provider failure", responses: () => [home(), redirect(), unavailable(502)], phase: "provider", reason: "http-status", status: 502 },
    { name: "unsafe redirect", responses: () => [home(), redirect("https://evil.example/private?token=private")], phase: "redirect", reason: "unsafe-redirect", status: 302 },
    { name: "malformed redirect", responses: () => [home(), redirect("https://[")], phase: "redirect", reason: "invalid-redirect", status: 302 },
    { name: "missing redirect location", responses: () => [home(), new Response(null, { status: 302 })], phase: "redirect", reason: "invalid-redirect", status: 302 },
    { name: "redirect limit", responses: () => [home(), redirect(), redirect(), redirect(), redirect()], phase: "redirect", reason: "redirect-limit", status: 302 },
    { name: "non-image content", responses: () => [home(), redirect(), new Response("private response", { headers: { "content-type": "text/html" } })], phase: "provider", reason: "invalid-content-type", status: 200 },
    { name: "missing image body", responses: () => [home(), redirect(), new Response(null, { headers: { "content-type": "image/jpeg" } })], phase: "provider", reason: "missing-body", status: 200 },
    { name: "empty image body", responses: () => [home(), redirect(), new Response(new Uint8Array(), { headers: { "content-type": "image/jpeg" } })], phase: "image-body", reason: "invalid-image-body", status: 200 },
    { name: "invalid image bytes", responses: () => [home(), redirect(), new Response("private image bytes", { headers: { "content-type": "image/jpeg" } })], phase: "image-body", reason: "invalid-image-body", status: 200 },
    { name: "image read failure", responses: () => [home(), redirect(), brokenBody()], phase: "image-body", reason: "body-read-failed", status: 200 },
  ])("reports bounded diagnostics for $name", async ({ responses, phase, reason, status }) => {
    const request = vi.fn();
    const sequence = responses();
    for (const response of sequence) request.mockResolvedValueOnce(response);
    expect(await runScheduledProbe(request)).toEqual({ status: "degraded", imageAvailable: false, rateLimitAvailable: true });
    expect(request).toHaveBeenCalledTimes(sequence.length);
    expect(captureBusinessEvent).toHaveBeenCalledExactlyOnceWith({
      source: "BUSINESS", severity: "HIGH", title: "Website image service needs attention",
      message: "The scheduled image or rate-limit service check failed. Check image delivery and the Upstash quota or connection.",
      action: "mediaHealthCheck", dedupeKey: expect.stringMatching(/^media-health:\d{4}-\d{2}-\d{2}$/), route: "/api/media/listing-photo",
      tags: {
        imageAvailable: false, rateLimitAvailable: true,
        imageProbePhase: phase, imageProbeReason: reason, imageProbeHttpStatus: status,
      },
    });
    const tags = vi.mocked(captureBusinessEvent).mock.calls[0][0].tags;
    expect(redactMonitoringPayload(tags)).toEqual(tags);
    expect(JSON.stringify(tags)).not.toMatch(/private|imageId|https?:|token/);
  });
  it.each(["not a URL", "http://itrader.im", "https://evil.example", "https://itrader.im:444", "https://user:private@itrader.im"])("rejects invalid origins without fetching: %s", async origin => {
    const request = vi.fn();
    expect(await runScheduledProbe(request, origin)).toEqual({ status: "degraded", imageAvailable: false, rateLimitAvailable: true });
    expect(request).not.toHaveBeenCalled();
    expect(captureBusinessEvent).toHaveBeenCalledWith(expect.objectContaining({
      tags: { imageAvailable: false, rateLimitAvailable: true, imageProbePhase: "origin", imageProbeReason: "invalid-origin" },
    }));
  });
  it.each([
    { phase: "homepage", preceding: () => [] },
    { phase: "listing-photo", preceding: () => [home()] },
    { phase: "provider", preceding: () => [home(), redirect()] },
  ])("does not retain an earlier HTTP status after $phase request fails", async ({ phase, preceding }) => {
    const request = vi.fn();
    for (const response of preceding()) request.mockResolvedValueOnce(response);
    request.mockRejectedValueOnce(new Error("https://private.example/photo?imageId=private"));
    await runScheduledProbe(request);
    expect(captureBusinessEvent).toHaveBeenCalledWith(expect.objectContaining({
      tags: { imageAvailable: false, rateLimitAvailable: true, imageProbePhase: phase, imageProbeReason: "request-failed" },
    }));
  });
  it.each(["TimeoutError", "AbortError"])("classifies %s without exposing exception details", async name => {
    const request = vi.fn().mockRejectedValueOnce(new DOMException("private timeout details", name));
    await runScheduledProbe(request);
    expect(captureBusinessEvent).toHaveBeenCalledWith(expect.objectContaining({
      tags: { imageAvailable: false, rateLimitAvailable: true, imageProbePhase: "homepage", imageProbeReason: "timeout" },
    }));
  });
  it.each([0, 99, 600, 999, 200.5, Number.NaN])("omits out-of-range HTTP status %s", async status => {
    const response = unavailable();
    Object.defineProperty(response, "status", { value: status });
    await runScheduledProbe(vi.fn().mockResolvedValueOnce(response));
    expect(captureBusinessEvent).toHaveBeenCalledWith(expect.objectContaining({
      tags: { imageAvailable: false, rateLimitAvailable: true, imageProbePhase: "homepage", imageProbeReason: "http-status" },
    }));
  });
  it("keeps healthy results unchanged without emitting an alert", async () => {
    expect(await runScheduledProbe(vi.fn().mockResolvedValueOnce(home()).mockResolvedValueOnce(redirect()).mockResolvedValueOnce(jpeg())))
      .toEqual({ status: "healthy", imageAvailable: true, rateLimitAvailable: true });
    expect(captureBusinessEvent).not.toHaveBeenCalled();
  });
  it("follows the public image route and verifies image bytes", async () => {
    const request = vi.fn().mockResolvedValueOnce(home()).mockResolvedValueOnce(redirect()).mockResolvedValueOnce(jpeg());
    expect(await probePublicImage("https://itrader.im", request)).toBe(true);
    expect(String(request.mock.calls[1][0])).toContain("imageId=test&source=listing");
    expect(String(request.mock.calls[1][0])).toContain("w=320");
  });
  it.each(["https://evil.example/image", "http://127.0.0.1/private", "https://itrader.im/media-unresolved.svg"])("does not accept an unsafe or placeholder image: %s", async url => {
    const request = vi.fn().mockResolvedValueOnce(home()).mockResolvedValueOnce(redirect(url)).mockResolvedValue(new Response('<svg></svg>', { headers: { "content-type": "image/svg+xml" } }));
    expect(await probePublicImage("https://itrader.im", request)).toBe(false);
    if (!url.startsWith("https://itrader.im")) expect(request).toHaveBeenCalledTimes(2);
  });
  it("does not mistake a working homepage for working photos", async () => {
    const request = vi.fn().mockResolvedValueOnce(home()).mockResolvedValue(new Response("Unavailable", { status: 503 }));
    expect(await probePublicImage("https://itrader.im", request)).toBe(false);
  });
  it("reports Redis failure even while the fallback keeps photos working", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://itrader.im");
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, unavailable: true, remaining: 0, resetAt: 60_000 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(home()).mockResolvedValueOnce(redirect()).mockResolvedValueOnce(jpeg()));
    expect(await runMediaHealthCheck()).toEqual({ status: "degraded", imageAvailable: true, rateLimitAvailable: false });
    expect(captureBusinessEvent).toHaveBeenCalledWith(expect.objectContaining({
      severity: "HIGH", dedupeKey: expect.stringMatching(/^media-health:\d{4}-\d{2}-\d{2}$/),
      tags: { imageAvailable: true, rateLimitAvailable: false, imageProbePhase: "image-body", imageProbeReason: "ok", imageProbeHttpStatus: 200 },
    }));
  });
  it.each(["preview", "development", ""])("does not run production probes from %s", async environment => {
    vi.stubEnv("VERCEL_ENV", environment);
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    expect(await runMediaHealthCheck()).toEqual({ status: "skipped" });
    expect(request).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(captureBusinessEvent).not.toHaveBeenCalled();
  });
});

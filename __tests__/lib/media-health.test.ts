import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/monitoring/capture", () => ({ captureBusinessEvent: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
import { probePublicImage, runMediaHealthCheck } from "@/lib/monitoring/media-health";
import { captureBusinessEvent } from "@/lib/monitoring/capture";
import { checkRateLimit } from "@/lib/rate-limit";

const home = () => new Response('<img src="/api/media/listing-photo?imageId=test&amp;source=listing&amp;mode=fill&amp;frame=card&amp;w=640">');
const redirect = (url = "https://ik.imagekit.io/example/photo") => new Response(null, { status: 302, headers: { location: url } });
const jpeg = () => new Response(new Uint8Array([255, 216, 255, ...Array(20).fill(0)]), { headers: { "content-type": "image/jpeg" } });
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("scheduled image checks", () => {
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
    expect(captureBusinessEvent).toHaveBeenCalledWith(expect.objectContaining({ severity: "HIGH", dedupeKey: "media-health" }));
  });
  it("does not run production probes from previews", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(await runMediaHealthCheck()).toEqual({ status: "skipped" });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(captureBusinessEvent).not.toHaveBeenCalled();
  });
});

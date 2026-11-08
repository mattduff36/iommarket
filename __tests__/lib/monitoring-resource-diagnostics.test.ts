// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createResourceDiagnostics, safeResourceDiagnostic } from "@/lib/monitoring/resource-diagnostics";

const selectedUrl = "https://ik.imagekit.io/private/responsive.jpg?token=private";
const timing = (overrides: Record<string, unknown> = {}) => ({
  name: selectedUrl, entryType: "resource", initiatorType: "img",
  startTime: 110, responseEnd: 190, duration: 80,
  responseStatus: 404, transferSize: 120, decodedBodySize: 90, ...overrides,
});
function setup(entries: Record<string, unknown>[] = [timing()]) {
  const performance = {
    now: vi.fn().mockReturnValueOnce(100).mockReturnValue(200),
    getEntriesByName: vi.fn().mockReturnValue(entries),
  };
  const browser = { location: { origin: "https://itrader.im" }, performance };
  return { collect: createResourceDiagnostics(browser), performance, browser };
}
function failure(target: unknown, timeStamp = 200): Event {
  return { target, timeStamp } as Event;
}
function responsiveImage() {
  const image = document.createElement("img");
  image.src = "https://itrader.im/api/media/listing-photo?photoId=private";
  image.alt = "private title";
  Object.defineProperty(image, "currentSrc", { value: selectedUrl });
  return image;
}

describe("closed resource failure evidence", () => {
  it("uses the selected responsive source for exact local timing and sends only closed facts", () => {
    const { collect, performance } = setup();
    const result = collect(failure(responsiveImage()));
    expect(performance.getEntriesByName).toHaveBeenCalledWith(selectedUrl, "resource");
    expect(result).toEqual({
      elementKind: "img", target: "provider:imagekit", responseStatus: 404,
      durationMs: 80, transferSize: 120, decodedBodySize: 90,
    });
    expect(JSON.stringify(result)).not.toMatch(/private|photoId|token|imagekit\.io|alt/);
  });

  it.each(["video", "audio"] as const)("classifies %s and reads only its numeric media error code", (kind) => {
    const media = document.createElement(kind);
    media.src = "/private/fallback.mp4?token=private";
    Object.defineProperty(media, "currentSrc", { value: selectedUrl });
    Object.defineProperty(media, "error", { value: { code: 3, message: "private decoder detail" } });
    const { collect } = setup([timing({ initiatorType: kind })]);
    expect(collect(failure(media))).toMatchObject({
      elementKind: kind, target: "provider:imagekit", mediaErrorCode: 3, responseStatus: 404,
    });
    expect(JSON.stringify(collect(failure(media)))).not.toMatch(/private|message|fallback/);
  });

  it("recognizes link href and fixed rel/as categories", () => {
    const link = document.createElement("link");
    link.href = "https://itrader.im/_next/static/chunks/private.css?secret=value";
    link.rel = "preload";
    link.setAttribute("as", "style");
    Object.defineProperty(link, "as", { value: "style" });
    const { collect } = setup([]);
    expect(collect(failure(link))).toEqual({
      elementKind: "link", target: "/_next/static/chunks/:segment", linkRel: "preload", linkAs: "style",
    });
  });

  it.each(["img", "script", "source"] as const)("falls back to %s src without assuming a response status", (kind) => {
    const element = document.createElement(kind);
    element.src = "https://itrader.im/api/media/listing-photo?photoId=private";
    const { collect } = setup([]);
    expect(collect(failure(element))).toEqual({ elementKind: kind, target: "/api/media/listing-photo" });
  });

  it("retains other and window target types without arbitrary DOM properties", () => {
    const { collect, browser } = setup([]);
    expect(collect(failure(browser))).toEqual({ elementKind: "window" });
    expect(collect(failure({ tagName: "CUSTOM-PRIVATE", src: selectedUrl, id: "private" }))).toEqual({ elementKind: "other" });
    expect(collect(failure(null))).toEqual({ elementKind: "other" });
  });

  it.each([0, undefined])("does not turn status %s into an HTTP failure", (responseStatus) => {
    const { collect } = setup([timing({ responseStatus })]);
    const result = collect(failure(responsiveImage()));
    expect(result).toMatchObject({ elementKind: "img", durationMs: 80 });
    if (responseStatus === 0) expect(result.responseStatus).toBe(0);
    else expect(result).not.toHaveProperty("responseStatus");
    expect(result).not.toHaveProperty("outcome");
  });

  it.each([
    { name: selectedUrl.replace("private", "different") },
    { initiatorType: "fetch" }, { entryType: "navigation" },
    { startTime: 90 }, { responseEnd: 201 }, { responseEnd: 0 },
    { startTime: NaN }, { duration: Infinity }, { duration: 300_001 },
  ])("omits unrelated or malformed timing (%#)", (override) => {
    const { collect } = setup([timing(override)]);
    expect(collect(failure(responsiveImage()))).toEqual({ elementKind: "img", target: "provider:imagekit" });
  });

  it("does not reuse prior timing or attach stale/ambiguous resource entries", () => {
    const { collect } = setup();
    const image = responsiveImage();
    expect(collect(failure(image))).toHaveProperty("responseStatus", 404);
    expect(collect(failure(image))).not.toHaveProperty("responseStatus");
    const stale = setup([timing()]); // Event is more than one second after completion.
    stale.performance.now.mockReturnValue(2_000);
    expect(stale.collect(failure(image, 2_000))).not.toHaveProperty("responseStatus");
    const ambiguous = setup([timing(), timing({ startTime: 115, responseEnd: 195 })]);
    expect(ambiguous.collect(failure(image))).not.toHaveProperty("responseStatus");
  });

  it("does not reuse a prior successful load's timing for a later error of the same URL", () => {
    const { collect, performance } = setup([timing({ responseStatus: 200 })]);
    const image = responsiveImage();
    collect({ target: image, timeStamp: 195, type: "load" } as unknown as Event);
    expect(collect(failure(image))).not.toHaveProperty("responseStatus");
    performance.getEntriesByName.mockReturnValue([timing({ responseStatus: 200 }), timing({
      startTime: 201, responseEnd: 220, duration: 19, responseStatus: 500,
    })]);
    performance.now.mockReturnValue(225);
    expect(collect(failure(image, 225))).toMatchObject({ responseStatus: 500, durationMs: 19 });
  });

  it("keeps classification when performance APIs or DOM getters are absent or throw", () => {
    const image = responsiveImage();
    const browser = { location: { origin: "https://itrader.im" } };
    expect(createResourceDiagnostics(browser)(failure(image))).toEqual({ elementKind: "img", target: "provider:imagekit" });
    const broken = { ...browser, get performance(): never { throw new Error("private"); } };
    expect(createResourceDiagnostics(broken)(failure(image))).toEqual({ elementKind: "img", target: "provider:imagekit" });
    const { collect, performance } = setup();
    performance.getEntriesByName.mockImplementation(() => { throw new Error("private"); });
    expect(collect(failure(image))).toEqual({ elementKind: "img", target: "provider:imagekit" });
    const brokenImage = { tagName: "IMG", get currentSrc(): never { throw new Error("private"); }, src: selectedUrl };
    expect(collect(failure(brokenImage))).toEqual({ elementKind: "img", target: "provider:imagekit" });
  });

  it("rejects impossible timestamps and numbers without losing safe type evidence", () => {
    for (const timeStamp of [NaN, Infinity, 0, -1, 1_700_000_000_000]) {
      expect(setup().collect(failure(responsiveImage(), timeStamp))).not.toHaveProperty("responseStatus");
    }
    expect(safeResourceDiagnostic({
      elementKind: "video", target: "/api/media/listing-photo", responseStatus: 999,
      mediaErrorCode: 5, durationMs: -1, transferSize: "300", decodedBodySize: Infinity,
    })).toEqual({ elementKind: "video", target: "/api/media/listing-photo" });
  });

  it("uses a closed sanitizer for every boundary and rejects raw URLs, IDs and extra fields", () => {
    expect(safeResourceDiagnostic({
      elementKind: "link", target: "/_next/static/chunks/:segment", linkRel: "stylesheet", linkAs: "style",
      responseStatus: 0, durationMs: 80, transferSize: 0, decodedBodySize: 90,
      url: selectedUrl, id: "private", alt: "private", message: "private", body: "private",
    })).toEqual({
      elementKind: "link", target: "/_next/static/chunks/:segment", linkRel: "stylesheet", linkAs: "style",
      responseStatus: 0, durationMs: 80, transferSize: 0, decodedBodySize: 90,
    });
    expect(safeResourceDiagnostic({ elementKind: "img", target: selectedUrl, responseStatus: 404 })).toEqual({ elementKind: "img" });
    expect(safeResourceDiagnostic({
      elementKind: "link", target: "/api/media/listing-photo?photoId=private",
      linkRel: "private", linkAs: "private", mediaErrorCode: 3,
    })).toEqual({ elementKind: "link" });
    expect(safeResourceDiagnostic({ elementKind: "window", target: "/search", mediaErrorCode: 3, responseStatus: 404 })).toEqual({ elementKind: "window" });
    for (const value of [null, [], "private", {}, { elementKind: "private" }]) expect(safeResourceDiagnostic(value)).toBeUndefined();
  });
});

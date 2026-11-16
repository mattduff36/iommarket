import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createMediaDenialReporter, mediaRequestFacts, safeMediaFacts } from "@/lib/media/request-diagnostics";
import { safeEventEvidence } from "@/scripts/fixerrors/evidence";

const path = "/api/media/listing-photo?imageId=img-1&source=listing&mode=fit&frame=gallery&w=1600";
describe("bounded server media diagnostics", () => {
  it("correlates asset identity across variants without leaking identifiers or URL fields", () => {
    const facts = mediaRequestFacts(path)!;
    expect(facts.assetFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(mediaRequestFacts(path.replace("1600", "320"))?.assetFingerprint).toBe(facts.assetFingerprint);
    expect(mediaRequestFacts(path.replace("img-1", "img-2"))?.assetFingerprint).not.toBe(facts.assetFingerprint);
    expect(mediaRequestFacts(path.replace("source=listing", "source=revision"))?.assetFingerprint).not.toBe(facts.assetFingerprint);
    expect(JSON.stringify(facts)).not.toContain("img-1");
    expect(facts).toMatchObject({ route: "/api/media/listing-photo", source: "listing", mode: "fit", frame: "gallery", width: 1600 });
  });
  it("hashes the full validated logo reference used by the database lookup", () => {
    const raw = "https://res.cloudinary.com/example/image/upload/logo.png?signature=private#sync";
    const facts = mediaRequestFacts(`/api/media/cloudinary-ref?url=${encodeURIComponent(raw)}`)!;
    expect(facts.assetFingerprint).toBe(createHash("sha256").update(JSON.stringify(["media-v1", "cloudinary-ref", raw])).digest("hex"));
    expect(JSON.stringify(facts)).not.toMatch(/private|logo.png|signature|res.cloudinary/);
    expect(mediaRequestFacts(`/api/media/cloudinary-ref?url=${encodeURIComponent(raw + "-different")}`)?.assetFingerprint).not.toBe(facts.assetFingerprint);
  });
  it.each(["/other?imageId=img-1", path.replace("1600", "99999"), path.replace("img-1", "bad%20id"), "/api/media/listing-photo", "https://evil.test" + path, "/api/media/cloudinary-ref?url=https://evil.test/logo", "/api/media/cloudinary-ref?url=https://user:pass@res.cloudinary.com/a", "/api/media/cloudinary-ref?url=" + "x".repeat(2001)])("omits unsupported or invalid identities %s", input => {
    expect(mediaRequestFacts(input)).toBeUndefined();
  });
  it("samples once per asset/source and caps total logs and memory each minute", () => {
    let now = 1000;
    const warn = vi.fn();
    const report = createMediaDenialReporter(() => now, warn);
    const input = { path, denialSource: "shared-window", retryAfterSeconds: 30, requestId: "lhr1::abc-123", release: "a".repeat(40) };
    report(input);report(input);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warn.mock.calls[0][0])).toMatchObject({ kind: "media-read-denied", status: 429, denialSource: "shared-window", retryAfterSeconds: 30, requestId: "lhr1::abc-123", release: "a".repeat(40) });
    for (let i = 0; i < 30; i++) report({ ...input, path: path.replace("img-1", `img-${i + 2}`) });
    expect(warn).toHaveBeenCalledTimes(20);
    now += 60_000;report(input);
    expect(warn).toHaveBeenCalledTimes(21);
  });
  it("drops unsafe metadata and never throws into the media response", () => {
    const warn = vi.fn();const report = createMediaDenialReporter(() => 1000, warn);
    report({ path, denialSource: "shared-window", retryAfterSeconds: Infinity, requestId: "secret@example.com", release: "secret" });
    const payload = JSON.parse(warn.mock.calls[0][0]);
    expect(payload).not.toHaveProperty("requestId");expect(payload).not.toHaveProperty("release");expect(payload).not.toHaveProperty("retryAfterSeconds");
    report({ path, denialSource: "unknown-value", retryAfterSeconds: 30 });expect(warn).toHaveBeenCalledTimes(1);
    expect(() => createMediaDenialReporter(() => 0, () => { throw Error("logging unavailable"); })({ path, denialSource: "local-window", retryAfterSeconds: 30 })).not.toThrow();
  });
  it("exports only closed media fields, rejecting malformed evidence", () => {
    const facts = mediaRequestFacts(path)!;
    expect(safeMediaFacts({ ...facts, rawUrl: "secret" })).toEqual(facts);
    expect(safeEventEvidence({ media: { ...facts, rawUrl: "secret" } })).toMatchObject({ mediaAssetFingerprint: facts.assetFingerprint, mediaWidth: 1600, mediaSource: "listing" });
    expect(safeEventEvidence({ media: { ...facts, assetFingerprint: "token" } })).not.toHaveProperty("mediaAssetFingerprint");
    expect(JSON.stringify(safeEventEvidence({ media: { ...facts, rawUrl: "secret" } }))).not.toContain("secret");
  });
});

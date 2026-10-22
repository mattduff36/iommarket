/* @vitest-environment node */
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
const { httpsGet } = vi.hoisted(() => ({ httpsGet: vi.fn() }));
vi.mock("node:https", () => ({ default: { get: httpsGet } }));
import {
  assertSafeRemoteImageUrl,
  downloadSafeRemoteImage,
  isPublicIpAddress,
  resolvePublicImageAddresses,
} from "@/lib/images/safe-remote-image";

const jpeg = Buffer.from([0xff, 0xd8, 0xff]);
const publicLookup = async () => [{ address: "1.1.1.1", family: 4 }];
type PinOptions = {
  family: number;
  lookup: (host: string, options: unknown, callback: (error: null, address: string, family: number) => void) => void;
};

function transportFixture(statusCode = 200, headers: Record<string, string> = {}) {
  const request = Object.assign(new EventEmitter(), {
    destroy: vi.fn(),
    setTimeout: vi.fn(),
  });
  const response = Object.assign(new EventEmitter(), { statusCode, headers, resume: vi.fn() });
  let options: PinOptions;
  let originalUrl: URL;
  let respond: () => void = () => { throw new Error("Transport is not ready."); };
  let readyResolve: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => { readyResolve = resolve; });
  httpsGet.mockImplementation((url: URL, received: PinOptions, callback: (value: typeof response) => void) => {
    originalUrl = url;
    options = received;
    respond = () => callback(response);
    readyResolve();
    return request;
  });
  return { request, response, ready, respond: () => respond(), options: () => options, url: () => originalUrl };
}

afterEach(() => {
  httpsGet.mockReset();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("SSRF-001 safe remote image downloads", () => {
  it("rejects private, local, mapped, transition, documentation and reserved addresses", () => {
    for (const address of [
      "127.0.0.1", "10.0.0.1", "169.254.169.254", "172.16.0.1",
      "192.168.0.1", "100.64.0.1", "198.51.100.1", "::1",
      "0:0:0:0:0:0:0:1", "fe80::1", "fec0::1", "fd00::1",
      "2001:db8::1", "2001:0db8::1", "::ffff:127.0.0.1",
      "::ffff:7f00:1", "0:0:0:0:0:ffff:7f00:1", "::127.0.0.1",
      "64:ff9b::7f00:1", "2002:7f00:1::1", "2001::1",
      "3fff::1", "5f00::1", "fe80::1%eth0",
    ]) expect(isPublicIpAddress(address), address).toBe(false);
    expect(isPublicIpAddress("1.1.1.1")).toBe(true);
    expect(isPublicIpAddress("2606:4700:4700::1111")).toBe(true);
    expect(isPublicIpAddress("2001:4860:4860::8888")).toBe(true);
  });

  it("rejects mixed DNS answers before connecting", async () => {
    await expect(resolvePublicImageAddresses("images.example", async () => [
      { address: "1.1.1.1", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ])).rejects.toThrow(/exclusively to public/);
    expect(httpsGet).not.toHaveBeenCalled();
  });

  it("carries the validated address, byte limit and abort deadline to an injected transport", async () => {
    const transport = vi.fn().mockResolvedValue({ bytes: jpeg, contentType: "image/jpeg" });
    const result = await downloadSafeRemoteImage({
      url: "https://images.example/photo.jpg", lookupImpl: publicLookup, transport,
      maxBytes: 1234, timeoutMs: 5678,
    });
    expect(result.bytes).toEqual(jpeg);
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      address: "1.1.1.1", family: 4, maxBytes: 1234, timeoutMs: 5678, signal: expect.any(AbortSignal),
    }));
  });

  it("pins every socket lookup to the validated IP and preserves the TLS hostname", async () => {
    const fixture = transportFixture();
    const lookup = vi.fn().mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }])
      .mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const pending = downloadSafeRemoteImage({ url: "https://images.example/photo.jpg", lookupImpl: lookup });
    await fixture.ready;
    const callback = vi.fn();
    fixture.options().lookup("images.example", {}, callback);
    fixture.options().lookup("images.example", {}, callback);
    expect(callback.mock.calls).toEqual([[null, "1.1.1.1", 4], [null, "1.1.1.1", 4]]);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(fixture.url().hostname).toBe("images.example");
    expect(fixture.options().family).toBe(4);
    fixture.respond();
    fixture.response.emit("data", jpeg);
    fixture.response.emit("end");
    await expect(pending).resolves.toMatchObject({ bytes: jpeg, contentType: "image/jpeg" });
  });

  it("rejects a redirect in the default HTTPS transport without following its private target", async () => {
    const fixture = transportFixture(302, { location: "https://127.0.0.1/private" });
    const pending = downloadSafeRemoteImage({ url: "https://images.example/photo.jpg", lookupImpl: publicLookup });
    const rejected = expect(pending).rejects.toThrow(/redirects are not allowed/);
    await fixture.ready;
    fixture.respond();
    await rejected;
    expect(httpsGet).toHaveBeenCalledTimes(1);
    expect(fixture.request.destroy).toHaveBeenCalledOnce();
  });

  it.each(["declared", "streamed"])("destroys an oversized %s response", async (kind) => {
    const fixture = transportFixture(200, kind === "declared" ? { "content-length": "11" } : {});
    const pending = downloadSafeRemoteImage({
      url: "https://images.example/photo.jpg", lookupImpl: publicLookup, maxBytes: 10,
    });
    const rejected = expect(pending).rejects.toThrow(/maximum file size/);
    await fixture.ready;
    fixture.respond();
    if (kind === "streamed") fixture.response.emit("data", Buffer.alloc(11));
    await rejected;
    expect(fixture.request.destroy).toHaveBeenCalledOnce();
  });

  it("bounds stalled DNS and never opens a connection if DNS finishes after the deadline", async () => {
    vi.useFakeTimers();
    let resolveDns: (value: Array<{ address: string; family: number }>) => void = () => undefined;
    const dns = new Promise<Array<{ address: string; family: number }>>((resolve) => { resolveDns = resolve; });
    const pending = downloadSafeRemoteImage({
      url: "https://images.example/photo.jpg", lookupImpl: () => dns, timeoutMs: 25,
    });
    const rejected = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    resolveDns(await publicLookup());
    await vi.advanceTimersByTimeAsync(0);
    expect(httpsGet).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("enforces the total deadline even while the response keeps delivering bytes", async () => {
    vi.useFakeTimers();
    const fixture = transportFixture();
    const pending = downloadSafeRemoteImage({
      url: "https://images.example/photo.jpg", lookupImpl: publicLookup, timeoutMs: 25,
    });
    const rejected = expect(pending).rejects.toThrow(/timed out/);
    await fixture.ready;
    fixture.respond();
    await vi.advanceTimersByTimeAsync(10);
    fixture.response.emit("data", jpeg);
    await vi.advanceTimersByTimeAsync(10);
    fixture.response.emit("data", jpeg);
    await vi.advanceTimersByTimeAsync(5);
    await rejected;
    expect(fixture.request.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects credentials, non-HTTPS URLs and unusual ports", () => {
    expect(() => assertSafeRemoteImageUrl("http://images.example/a.jpg")).toThrow(/public HTTPS/);
    expect(() => assertSafeRemoteImageUrl("https://user:pass@images.example/a.jpg")).toThrow(/public HTTPS/);
    expect(() => assertSafeRemoteImageUrl("https://images.example:8443/a.jpg")).toThrow(/public HTTPS/);
  });
});

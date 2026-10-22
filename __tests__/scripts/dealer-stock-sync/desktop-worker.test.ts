/* @vitest-environment node */
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { desktopRuntimeEnvironment, parseDesktopMode, readDesktopBootstrap, validateDesktopBootstrap } from "@/scripts/dealer-stock-sync/desktop-worker";

const token = "t".repeat(43);
describe("token-only desktop bootstrap", () => {
  it("accepts only the exact two fields for either explicit environment", () => {
    for (const environment of ["preview", "production"]) {
      const body = { environment, accessToken: token };
      expect(validateDesktopBootstrap(body)).toEqual(body);
    }
    for (const body of [
      { environment: "preview", accessToken: token, config: {} },
      { environment: "preview", accessToken: token, DATABASE_URL: "synthetic" },
      { environment: "preview", accessToken: token, IMAGEKIT_PRIVATE_KEY: "synthetic" },
      { environment: "constructor", accessToken: token },
      { environment: "preview", accessToken: "bad" },
      Object.assign(Object.create({ environment: "preview" }), { accessToken: token, extra: true }),
    ]) expect(() => validateDesktopBootstrap(body)).toThrow();
  });
  it("keeps only a bounded OS environment and the pinned Node path", () => {
    const env = desktopRuntimeEnvironment({
      SYSTEMROOT: "C:/Windows", TEMP: "C:/Temp", Path: "C:/untrusted",
      NODE_OPTIONS: "--require private", NODE_EXTRA_CA_CERTS: "private",
      HTTP_PROXY: "private", HTTPS_PROXY: "private", DATABASE_URL: "private",
      IMAGEKIT_PRIVATE_KEY: "private", DEALER_STOCK_DESKTOP_CONFIG_JSON: "private",
    }, "C:/installed/runtime/node.exe");
    expect(env.TEMP).toBe("C:/Temp"); expect(env.NODE_ENV).toBe("production");
    expect(env.PATH).toContain("installed/runtime");
    expect(JSON.stringify(env)).not.toMatch(/private|untrusted|DATABASE|IMAGEKIT|HTTP_PROXY|NODE_OPTIONS/);
  });
  it("reads one strict UTF-8 bounded newline frame and keeps the safe-stop pipe open", async () => {
    const pipe = new PassThrough(); const read = readDesktopBootstrap(pipe);
    pipe.write(JSON.stringify({ environment: "preview", accessToken: token }) + "\n");
    await expect(read).resolves.toEqual({ environment: "preview", accessToken: token });
    expect(pipe.destroyed).toBe(false); pipe.destroy();
  });
  it("rejects early EOF, oversized input, invalid UTF-8 and a missing frame deadline", async () => {
    const ended = new PassThrough(); const read = readDesktopBootstrap(ended); ended.end();
    await expect(read).rejects.toThrow("closed");
    const large = new PassThrough(); const oversized = readDesktopBootstrap(large); large.write(Buffer.alloc(65_537));
    await expect(oversized).rejects.toThrow("large"); large.destroy();
    const bad = new PassThrough(); const invalid = readDesktopBootstrap(bad); bad.write(Buffer.from([0xff, 10]));
    await expect(invalid).rejects.toThrow("Invalid"); bad.destroy();
    const stalled = new PassThrough(); await expect(readDesktopBootstrap(stalled, 1)).rejects.toThrow("did not send"); stalled.destroy();
  });
  it("only accepts manual check or watch modes", () => {
    expect(parseDesktopMode(["--mode", "check"])).toBe("check");
    expect(parseDesktopMode(["--mode", "watch"])).toBe("watch");
    for (const args of [[], ["--mode", "watch", "--weekly"], ["--mode", "schedule"], ["--watch"]]) {
      expect(() => parseDesktopMode(args)).toThrow();
    }
  });
});

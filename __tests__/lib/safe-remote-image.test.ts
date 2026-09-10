import { describe, expect, it, vi } from "vitest";
import {
  assertSafeRemoteImageUrl,
  downloadSafeRemoteImage,
  isPublicIpAddress,
  resolvePublicImageAddresses,
} from "@/lib/images/safe-remote-image";

describe("SSRF-001 safe remote image downloads", () => {
  it("rejects private, link-local, documentation, and reserved addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.0.1",
      "100.64.0.1",
      "198.51.100.1",
      "::1",
      "fe80::1",
      "fd00::1",
      "2001:db8::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPublicIpAddress(address), address).toBe(false);
    }
    expect(isPublicIpAddress("1.1.1.1")).toBe(true);
    expect(isPublicIpAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("rejects mixed DNS answers instead of selecting only the public answer", async () => {
    await expect(
      resolvePublicImageAddresses("images.example", async () => [
        { address: "1.1.1.1", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ]),
    ).rejects.toThrow(/exclusively to public/);
  });

  it("pins the validated address and carries byte and timeout limits", async () => {
    const transport = vi.fn().mockResolvedValue({
      bytes: Buffer.from([0xff, 0xd8, 0xff]),
      contentType: "image/jpeg",
    });
    const result = await downloadSafeRemoteImage({
      url: "https://images.example/photo.jpg",
      lookupImpl: async () => [{ address: "1.1.1.1", family: 4 }],
      transport,
      maxBytes: 1234,
      timeoutMs: 5678,
    });
    expect(result.bytes).toHaveLength(3);
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      address: "1.1.1.1",
      family: 4,
      maxBytes: 1234,
      timeoutMs: 5678,
    }));
  });

  it("rejects credentials, redirects by construction, non-HTTPS, and unusual ports", () => {
    expect(() => assertSafeRemoteImageUrl("http://images.example/a.jpg")).toThrow(/public HTTPS/);
    expect(() => assertSafeRemoteImageUrl("https://user:pass@images.example/a.jpg")).toThrow(/public HTTPS/);
    expect(() => assertSafeRemoteImageUrl("https://images.example:8443/a.jpg")).toThrow(/public HTTPS/);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { isAllowedDealerLogoUrl, renderDealerSocialImage } from "@/lib/images/dealer-social";

const download = vi.hoisted(() => vi.fn());
vi.mock("@/lib/images/safe-remote-image", () => ({ downloadSafeRemoteImage: download }));

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("dealer social cards", () => {
  it("only downloads owned storage or the configured Cloudinary cloud", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", "owned");
    expect(isAllowedDealerLogoUrl("https://project.supabase.co/storage/v1/object/public/user-avatars/logo.png")).toBe(true);
    expect(isAllowedDealerLogoUrl("https://snlqivvogfqesxpbjiei.supabase.co/storage/v1/object/public/user-avatars/logo.png")).toBe(true);
    expect(isAllowedDealerLogoUrl("https://snlqivvogfqesxpbjiei.supabase.co/auth/v1/user")).toBe(false);
    expect(isAllowedDealerLogoUrl("https://res.cloudinary.com/owned/image/upload/v1/logo.png")).toBe(true);
    expect(isAllowedDealerLogoUrl("https://res.cloudinary.com/owned/image/upload/v1/logo.png#itrader-database-sync-readonly")).toBe(true);
    expect(isAllowedDealerLogoUrl("https://res.cloudinary.com/owned/image/upload/v1/logo.png#untrusted-marker")).toBe(false);
    for (const url of [
      "https://127.0.0.1/logo.png", "https://evil.example/logo.png",
      "https://res.cloudinary.com/other/image/upload/logo.png",
      "https://project.supabase.co/auth/v1/user", "https://project.supabase.co.evil.example/storage/v1/object/public/user-avatars/logo.png",
      "https://user@project.supabase.co/storage/v1/object/public/user-avatars/logo.png",
      "https://project.supabase.co/storage/v1/object/public/user-avatars/logo.png?redirect=evil",
    ]) expect(isAllowedDealerLogoUrl(url)).toBe(false);
    await expect(renderDealerSocialImage("Dealer", "https://127.0.0.1/logo.png")).rejects.toThrow();
    expect(download).not.toHaveBeenCalled();
  });

  it("renders an actual 1200 by 630 PNG from a complete contained logo", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    download.mockResolvedValue({ contentType: "image/png", bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1sAAAAASUVORK5CYII=", "base64") });
    const bytes = Buffer.from(await renderDealerSocialImage("Example Dealer", "https://project.supabase.co/storage/v1/object/public/user-avatars/logo.png"));
    expect(bytes.toString("ascii", 1, 4)).toBe("PNG");
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(630);
    expect(download).toHaveBeenCalledWith(expect.objectContaining({ maxBytes: 5 * 1024 * 1024, timeoutMs: 5000 }));
  });
});

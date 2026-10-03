import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ find: vi.fn(), where: vi.fn(), render: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { dealerProfile: { findFirst: mocks.find } } }));
vi.mock("@/lib/dealers/access", () => ({ getMarketplaceDealerWhereWithSettings: mocks.where }));
vi.mock("@/lib/images/dealer-social", () => ({ renderDealerSocialImage: mocks.render }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.limit }));
import { GET } from "@/app/(public)/dealers/[slug]/social-image/route";

const request = (slug = "example-dealer") => GET(new Request("https://itrader.im/dealers/example-dealer/social-image?url=https://evil.example"), { params: Promise.resolve({ slug }) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockResolvedValue({ allowed: true });
  mocks.where.mockResolvedValue({ publicEligibility: true });
  mocks.find.mockResolvedValue({ name: "Example Dealer", logoUrl: "https://owned.example/logo.png" });
  mocks.render.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
});

describe("dealer social image endpoint", () => {
  it("uses the public dealer eligibility filter and stored logo, ignoring URL query inputs", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(mocks.where).toHaveBeenCalledWith(null);
    expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [{ slug: "example-dealer", isAdminPreview: false }, { publicEligibility: true }] } }));
    expect(mocks.render).toHaveBeenCalledWith("Example Dealer", "https://owned.example/logo.png");
  });
  it("never renders unavailable or private dealers", async () => {
    mocks.find.mockResolvedValue(null);
    expect((await request()).status).toBe(404);
    expect(mocks.render).not.toHaveBeenCalled();
  });
  it("rejects invalid slugs and rate limited requests before querying", async () => {
    expect((await request("../secret")).status).toBe(404);
    mocks.limit.mockResolvedValue({ allowed: false });
    expect((await request()).status).toBe(429);
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it("returns the official full-size shared card when the logo cannot be rendered", async () => {
    mocks.render.mockRejectedValue(new Error("bad logo"));
    const response = await request();
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.toString("ascii", 1, 4)).toBe("PNG");
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(630);
  });
});

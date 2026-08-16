import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("Next image configuration", () => {
  it("allows the Morris Register dealer logo host", () => {
    expect(nextConfig.images?.remotePatterns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          protocol: "https",
          hostname: "morrisregister.co.uk",
        }),
      ]),
    );
  });
});

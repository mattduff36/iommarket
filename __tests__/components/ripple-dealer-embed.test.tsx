import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RippleDealerEmbed } from "@/components/payments/ripple-dealer-embed";
import {
  getRippleDealerEmbedScriptUrl,
  RIPPLE_DEALER_EMBED_CLIENT_ID,
  RIPPLE_DEALER_EMBED_SLUG,
} from "@/lib/payments/ripple-dealer-embed";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";

vi.mock("next/script", () => ({
  default: ({ src }: { src: string }) => (
    <script data-testid="ripple-embed-script" src={src} />
  ),
}));

describe("RippleDealerEmbed", () => {
  it("loads the dealer embed-signup script for the live client and slug", () => {
    const { container } = render(<RippleDealerEmbed />);
    const root = container.querySelector(".ripple-dealer-embed");
    expect(container.querySelector("[data-ripple-signup]")).toBeTruthy();
    expect(root?.getAttribute("data-ripple-embed-src")).toBe(
      "https://portal.startyourripple.co.uk/card/codelabplatfdcf3a8/embed-signup/-dealer-subscription",
    );
    expect(RIPPLE_DEALER_EMBED_CLIENT_ID).toBe("codelabplatfdcf3a8");
    expect(RIPPLE_DEALER_EMBED_SLUG).toBe("-dealer-subscription");
    expect(getRippleDealerEmbedScriptUrl()).not.toContain(
      `/pay/${RIPPLE_CANONICAL_PRODUCTS.listing.code}`,
    );
    expect(getRippleDealerEmbedScriptUrl()).not.toContain(
      `/pay/${RIPPLE_CANONICAL_PRODUCTS.featured.code}`,
    );
  });
});

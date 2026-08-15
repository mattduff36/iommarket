import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FOOTER_NAV_ITEMS } from "@/lib/navigation";
import { getAllPolicyDocuments } from "@/lib/policies/loader";
import {
  LEGAL_NAV_ITEMS,
  LEGAL_ROUTES,
  buildBundleVersion,
  isLegalRoute,
} from "@/lib/policies/registry";
import { POLICY_SLUGS } from "@/lib/policies/types";
import {
  COMPANY,
  MARKETPLACE_PUBLIC_PRICES,
  getDataControllerReference,
} from "@/lib/policy/company";

const PLACEHOLDER_RE = /\[[A-Z0-9 _-]+\]/g;
const APPROVED_PLACEHOLDERS = new Set(["[Pending Registration Number]"]);

describe("POL-DOC-001 canonical policy corpus", () => {
  const documents = getAllPolicyDocuments();

  it("publishes all seven policies with immutable versions and hashes", () => {
    expect(documents.map((doc) => doc.slug)).toEqual([...POLICY_SLUGS]);
    for (const doc of documents) {
      expect(doc.version).toBe(COMPANY.policyVersion);
      expect(doc.effectiveDate).toBe(COMPANY.policyEffectiveDate);
      expect(doc.markdown.length).toBeGreaterThan(400);
      expect(doc.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(doc.markdown).toContain(COMPANY.companyNumber);
      expect(doc.markdown).toContain("Ny Croityn");
      expect(doc.markdown).toContain("Bay View Road");
      expect(doc.markdown).toContain("Port Erin");
      expect(doc.markdown).toContain("IM9 6NA");
      expect(doc.markdown).toContain(COMPANY.email);
      expect(doc.markdown).toContain("14 August 2026");
    }
  });

  it("uses confirmed prices and treats N/S as the written-off exception", () => {
    const joined = documents.map((doc) => doc.markdown).join("\n");
    expect(joined).toContain(MARKETPLACE_PUBLIC_PRICES.privateListing);
    expect(joined).toContain(MARKETPLACE_PUBLIC_PRICES.featured);
    expect(joined).toContain(MARKETPLACE_PUBLIC_PRICES.dealerStarter);
    expect(joined).toContain(MARKETPLACE_PUBLIC_PRICES.dealerPro);
    expect(joined).not.toMatch(/standard private (vehicle )?Listing (fee )?is £5\b/i);
    expect(joined).toMatch(/permitted exception/);
    expect(joined).toContain("Vehicle Check");
    expect(joined).toContain("Supabase");
    expect(joined).toContain("Vercel");
    expect(joined).toContain("Cloudinary");
    expect(joined).toContain("Resend");
    expect(joined).toContain("Ripple");
    expect(joined).not.toContain("password (stored in encrypted form)");
    expect(joined).not.toContain(
      "By continuing to use the Platform, and where relevant by providing your consent",
    );
  });

  it("keeps only the approved pending-registration placeholder", () => {
    const leftovers = documents.flatMap((doc) =>
      [...(doc.markdown.match(PLACEHOLDER_RE) ?? [])].filter(
        (value) => !APPROVED_PLACEHOLDERS.has(value),
      ),
    );
    expect(leftovers).toEqual([]);
    expect(getDataControllerReference({})).toBe(
      COMPANY.dataControllerRefPlaceholder,
    );
  });

  it("builds deterministic bundle versions in registry order", () => {
    expect(buildBundleVersion("AGE_18")).toBe("AGE_18:1");
    expect(buildBundleVersion("ACCOUNT_BUNDLE")).toBe(
      "ACCOUNT_BUNDLE:privacy=2026-08-14.1|terms=2026-08-14.1|acceptable-use=2026-08-14.1",
    );
    expect(buildBundleVersion("LISTING_BUNDLE")).toBe(
      "LISTING_BUNDLE:private-seller-terms=2026-08-14.1|acceptable-use=2026-08-14.1|refunds=2026-08-14.1",
    );
    expect(buildBundleVersion("DEALER_BUNDLE")).toBe(
      "DEALER_BUNDLE:dealer-terms=2026-08-14.1|acceptable-use=2026-08-14.1|refunds=2026-08-14.1",
    );
  });

  it("exposes legal routes in navigation, sitemap, and middleware", () => {
    for (const href of LEGAL_ROUTES) {
      expect(FOOTER_NAV_ITEMS.some((item) => item.href === href)).toBe(true);
      expect(isLegalRoute(href)).toBe(true);
    }
    expect(LEGAL_NAV_ITEMS).toHaveLength(7);

    const sitemap = readFileSync(
      resolve(process.cwd(), "app", "sitemap.ts"),
      "utf8",
    );
    const middleware = readFileSync(
      resolve(process.cwd(), "middleware.ts"),
      "utf8",
    );
    for (const href of LEGAL_ROUTES) {
      expect(sitemap).toContain(`"${href}"`);
      expect(middleware).toContain(`pathname === "${href}"`);
    }
  });

  it("does not allow CMS overrides on legal routes", () => {
    for (const slug of POLICY_SLUGS) {
      const page = readFileSync(
        resolve(
          process.cwd(),
          "app",
          "(public)",
          slug,
          "page.tsx",
        ),
        "utf8",
      );
      expect(page).not.toContain("getPublishedPage");
      expect(page).toContain("PolicyDocumentPage");
    }
  });
});

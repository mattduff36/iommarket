import { COMPANY } from "@/lib/policy/company";
import {
  POLICY_BUNDLES,
  POLICY_SLUGS,
  type PolicyAcceptanceType,
  type PolicyDefinition,
  type PolicySlug,
} from "@/lib/policies/types";

const CURRENT_VERSION = COMPANY.policyVersion;
const CURRENT_EFFECTIVE_DATE = COMPANY.policyEffectiveDate;
const LAUNCH_VERSION = "2026-08-17.1";
const DEALER_REVIEW_VERSION = "2026-08-17.2";
const EFFECTIVE_ON_LAUNCH = "on launch";

export const POLICY_DEFINITIONS: Record<PolicySlug, PolicyDefinition> = {
  privacy: {
    slug: "privacy",
    title: "Privacy Policy",
    route: "/privacy",
    version: DEALER_REVIEW_VERSION,
    effectiveDate: EFFECTIVE_ON_LAUNCH,
    fileName: "privacy.md",
  },
  cookies: {
    slug: "cookies",
    title: "Cookie Policy",
    route: "/cookies",
    version: LAUNCH_VERSION,
    effectiveDate: EFFECTIVE_ON_LAUNCH,
    fileName: "cookies.md",
  },
  terms: {
    slug: "terms",
    title: "Terms and Conditions",
    route: "/terms",
    version: DEALER_REVIEW_VERSION,
    effectiveDate: EFFECTIVE_ON_LAUNCH,
    fileName: "terms.md",
  },
  "dealer-terms": {
    slug: "dealer-terms",
    title: "Dealer Terms",
    route: "/dealer-terms",
    version: DEALER_REVIEW_VERSION,
    effectiveDate: EFFECTIVE_ON_LAUNCH,
    fileName: "dealer-terms.md",
  },
  "private-seller-terms": {
    slug: "private-seller-terms",
    title: "Private Seller Terms",
    route: "/private-seller-terms",
    version: LAUNCH_VERSION,
    effectiveDate: EFFECTIVE_ON_LAUNCH,
    fileName: "private-seller-terms.md",
  },
  "acceptable-use": {
    slug: "acceptable-use",
    title: "Acceptable Use Policy",
    route: "/acceptable-use",
    version: DEALER_REVIEW_VERSION,
    effectiveDate: EFFECTIVE_ON_LAUNCH,
    fileName: "acceptable-use.md",
  },
  refunds: {
    slug: "refunds",
    title: "Refund Policy",
    route: "/refunds",
    version: CURRENT_VERSION,
    effectiveDate: CURRENT_EFFECTIVE_DATE,
    fileName: "refunds.md",
  },
  "vehicle-check-terms": {
    slug: "vehicle-check-terms",
    title: "Vehicle Check Terms",
    route: "/vehicle-check-terms",
    version: LAUNCH_VERSION,
    effectiveDate: EFFECTIVE_ON_LAUNCH,
    fileName: "vehicle-check-terms.md",
  },
};

export const LEGAL_NAV_ITEMS = POLICY_SLUGS.map((slug) => ({
  label: POLICY_DEFINITIONS[slug].title,
  href: POLICY_DEFINITIONS[slug].route,
}));

export const LEGAL_ROUTES = POLICY_SLUGS.map(
  (slug) => POLICY_DEFINITIONS[slug].route,
);

export function isLegalRoute(pathname: string) {
  return LEGAL_ROUTES.includes(pathname as (typeof LEGAL_ROUTES)[number]);
}

export function getPolicyDefinition(slug: PolicySlug) {
  return POLICY_DEFINITIONS[slug];
}

export function buildBundleVersion(
  type: PolicyAcceptanceType,
  versions: Record<PolicySlug, string> = Object.fromEntries(
    POLICY_SLUGS.map((slug) => [slug, POLICY_DEFINITIONS[slug].version]),
  ) as Record<PolicySlug, string>,
) {
  if (type === "AGE_18") {
    return "AGE_18:1";
  }

  const members = POLICY_SLUGS.filter((slug) =>
    (POLICY_BUNDLES[type] as readonly PolicySlug[]).includes(slug),
  );
  const encoded = members
    .map((slug) => `${slug}=${versions[slug]}`)
    .join("|");
  return `${type}:${encoded}`;
}

export function policyVersionsForBundle(type: PolicyAcceptanceType) {
  if (type === "AGE_18") {
    return { AGE_18: "1" };
  }

  return Object.fromEntries(
    (POLICY_BUNDLES[type] as readonly PolicySlug[]).map((slug) => [
      slug,
      POLICY_DEFINITIONS[slug].version,
    ]),
  );
}

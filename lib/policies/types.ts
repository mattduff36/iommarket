export const POLICY_SLUGS = [
  "privacy",
  "cookies",
  "terms",
  "dealer-terms",
  "private-seller-terms",
  "acceptable-use",
  "refunds",
] as const;

export type PolicySlug = (typeof POLICY_SLUGS)[number];

export const POLICY_ACCEPTANCE_TYPES = [
  "AGE_18",
  "ACCOUNT_BUNDLE",
  "LISTING_BUNDLE",
  "DEALER_BUNDLE",
  "PRIVACY_NOTICE",
] as const;

export type PolicyAcceptanceType = (typeof POLICY_ACCEPTANCE_TYPES)[number];

export const POLICY_BUNDLES = {
  AGE_18: [] as const,
  ACCOUNT_BUNDLE: ["terms", "acceptable-use", "privacy"] as const,
  LISTING_BUNDLE: ["private-seller-terms", "acceptable-use", "refunds"] as const,
  DEALER_BUNDLE: ["dealer-terms", "acceptable-use", "refunds"] as const,
  PRIVACY_NOTICE: ["privacy"] as const,
} satisfies Record<PolicyAcceptanceType, readonly PolicySlug[]>;

export interface PolicyDefinition {
  slug: PolicySlug;
  title: string;
  route: `/${string}`;
  version: string;
  effectiveDate: string;
  fileName: `${PolicySlug}.md`;
}

export interface PolicyDocument extends PolicyDefinition {
  markdown: string;
  contentHash: string;
}

import type { ListingModerationReason } from "@prisma/client";

export const MODERATION_TAXONOMY_VERSION = "2026-08-17.1";

export const LISTING_MODERATION_REASONS = [
  "FRAUD",
  "PROHIBITED",
  "MISLEADING",
  "DUPLICATE",
  "POLICY",
  "SAFETY",
  "ACCOUNT_DISABLED",
  "OTHER",
] as const satisfies readonly ListingModerationReason[];

export const LISTING_MODERATION_REASON_LABELS: Record<
  ListingModerationReason,
  string
> = {
  FRAUD: "Fraud or scam",
  PROHIBITED: "Prohibited item",
  MISLEADING: "Misleading or inaccurate",
  DUPLICATE: "Duplicate listing",
  POLICY: "Policy violation",
  SAFETY: "Safety concern",
  ACCOUNT_DISABLED: "Account disabled",
  OTHER: "Other",
};

export const REASONS_REQUIRING_NOTES: ReadonlySet<ListingModerationReason> =
  new Set(["OTHER"]);

export interface ModerationSubReasonDefinition {
  code: string;
  parent: ListingModerationReason;
  label: string;
  sellerExplanation: string;
  clauseRefs: readonly string[];
  correction: string;
  resubmit: string;
  appeal: string;
  refundAdvisory: string;
  retired: boolean;
}

const DEFAULT_APPEAL =
  "If you believe this decision is wrong, contact hello@itrader.im with the listing ID and supporting evidence.";
const DEFAULT_REFUND =
  "This moderation decision does not trigger a refund or payment action. Any refund request is considered separately under the Refund Policy and applicable statutory rights.";

export const MODERATION_SUB_REASONS: readonly ModerationSubReasonDefinition[] = [
  {
    code: "fraud.identity-or-ownership",
    parent: "FRAUD",
    label: "Identity or authority to sell could not be verified",
    sellerExplanation:
      "We could not verify the seller's identity, ownership, or authority to advertise the vehicle.",
    clauseRefs: ["Terms 8.1", "Terms 11", "AUP 9"],
    correction: "Provide accurate identity, ownership, or authority evidence.",
    resubmit: "Resubmit only after the requested evidence and listing details are complete.",
    appeal: DEFAULT_APPEAL,
    refundAdvisory: DEFAULT_REFUND,
    retired: false,
  },
  {
    code: "fraud.payment-or-phishing",
    parent: "FRAUD",
    label: "Payment, phishing, or scam concern",
    sellerExplanation:
      "The listing or related activity showed indicators of a payment scam, phishing attempt, or other dishonest conduct.",
    clauseRefs: ["Terms 7.5", "Terms 11", "AUP 9"],
    correction: "Remove deceptive payment instructions, links, or claims and provide requested evidence.",
    resubmit: "Resubmission may be unavailable while fraud checks remain open.",
    appeal: DEFAULT_APPEAL,
    refundAdvisory: DEFAULT_REFUND,
    retired: false,
  },
  {
    code: "prohibited.stolen-or-unauthorised",
    parent: "PROHIBITED",
    label: "Stolen vehicle or no authority to advertise",
    sellerExplanation:
      "The vehicle appears stolen, unlawfully obtained, or advertised without the owner's authority.",
    clauseRefs: ["Terms 8.2", "AUP 4.4"],
    correction: "Provide evidence of ownership or the owner's authority to advertise.",
    resubmit: "Do not resubmit unless you can establish lawful authority.",
    appeal: DEFAULT_APPEAL,
    refundAdvisory: DEFAULT_REFUND,
    retired: false,
  },
  {
    code: "prohibited.write-off-disclosure",
    parent: "PROHIBITED",
    label: "Prohibited write-off or missing Category N/S disclosure",
    sellerExplanation:
      "Written-off vehicles are prohibited except for clearly disclosed Category N or Category S vehicles.",
    clauseRefs: ["Terms 8.2", "AUP 4.1-4.2", "AUP 6"],
    correction: "Select the correct write-off category and disclose Category N or S clearly where permitted.",
    resubmit: "A corrected Category N or S listing may be resubmitted; other write-off categories must not be advertised.",
    appeal: DEFAULT_APPEAL,
    refundAdvisory: DEFAULT_REFUND,
    retired: false,
  },
  {
    code: "prohibited.unsupported-goods",
    parent: "PROHIBITED",
    label: "Unsupported goods, services, parts, or plates",
    sellerExplanation:
      "The listing advertises goods or services that are not currently permitted on iTrader.im.",
    clauseRefs: ["Terms 8.2", "AUP 6"],
    correction: "Remove unsupported goods or services and advertise only an allowed vehicle category.",
    resubmit: "Resubmit only if the revised listing is for a permitted vehicle.",
    appeal: DEFAULT_APPEAL,
    refundAdvisory: DEFAULT_REFUND,
    retired: false,
  },
  {
    code: "misleading.vehicle-details",
    parent: "MISLEADING",
    label: "Vehicle details or price are inaccurate",
    sellerExplanation:
      "Important vehicle, price, condition, history, or availability information appears inaccurate or incomplete.",
    clauseRefs: ["Terms 8.1", "AUP 3", "AUP 4.6"],
    correction: "Correct the inaccurate fields and clearly disclose material facts.",
    resubmit: "You may resubmit after correcting all affected details.",
    appeal: DEFAULT_APPEAL,
    refundAdvisory: DEFAULT_REFUND,
    retired: false,
  },
  {
    code: "misleading.mileage",
    parent: "MISLEADING",
    label: "Mileage is inaccurate or misleading",
    sellerExplanation:
      "The stated mileage could not be reconciled with the listing or available evidence.",
    clauseRefs: ["Terms 8.1", "AUP 4.5"],
    correction: "Enter the accurate mileage and explain any documented discrepancy.",
    resubmit: "You may resubmit with accurate mileage and supporting evidence where requested.",
    appeal: DEFAULT_APPEAL,
    refundAdvisory: DEFAULT_REFUND,
    retired: false,
  },
  {
    code: "misleading.photos",
    parent: "MISLEADING",
    label: "Photographs do not accurately show the vehicle",
    sellerExplanation:
      "One or more photographs appear unrelated, copied, materially misleading, or otherwise unsuitable.",
    clauseRefs: ["Terms 8.1", "AUP 3", "AUP 5"],
    correction: "Upload genuine, suitable photographs of the advertised vehicle.",
    resubmit: "You may resubmit after replacing every affected photograph.",
    appeal: DEFAULT_APPEAL,
    refundAdvisory: DEFAULT_REFUND,
    retired: false,
  },
  {
    code: "duplicate.same-vehicle",
    parent: "DUPLICATE",
    label: "Duplicate listing for the same vehicle",
    sellerExplanation:
      "Another active or submitted listing appears to advertise the same vehicle.",
    clauseRefs: ["Terms 8.2", "AUP 4.3"],
    correction: "Keep one accurate listing and remove unintended duplicates.",
    resubmit: "Resubmit only if this is a distinct vehicle or the earlier listing is no longer active.",
    appeal: DEFAULT_APPEAL,
    refundAdvisory: DEFAULT_REFUND,
    retired: false,
  },
  {
    code: "policy.account-or-commercial-status",
    parent: "POLICY",
    label: "Account or seller status does not match the listing",
    sellerExplanation:
      "The listing appears to use the wrong seller or account type, including commercial trading through a private account.",
    clauseRefs: ["Private Seller Terms 9", "Dealer Terms 3", "AUP 7-8"],
    correction: "Use the correct account type and provide accurate seller or business details.",
    resubmit: "Resubmit after the account and seller status have been corrected.",
    appeal: DEFAULT_APPEAL,
    refundAdvisory: DEFAULT_REFUND,
    retired: false,
  },
  {
    code: "policy.content-or-conduct",
    parent: "POLICY",
    label: "Content or conduct breaches platform rules",
    sellerExplanation:
      "The listing content or related conduct does not comply with the published platform rules.",
    clauseRefs: ["Terms 8", "Terms 14", "AUP 5", "AUP 10-13"],
    correction: "Remove the non-compliant content or conduct described by the moderation team.",
    resubmit: "You may resubmit after every identified issue is corrected.",
    appeal: DEFAULT_APPEAL,
    refundAdvisory: DEFAULT_REFUND,
    retired: false,
  },
  {
    code: "safety.dangerous-vehicle",
    parent: "SAFETY",
    label: "Potential vehicle safety risk",
    sellerExplanation:
      "The listing may conceal or misstate a condition that could create a vehicle safety risk.",
    clauseRefs: ["Terms 8.1", "AUP 3"],
    correction: "Correct the description and clearly disclose relevant safety or condition information.",
    resubmit: "Resubmit only after the safety information is accurate and complete.",
    appeal: DEFAULT_APPEAL,
    refundAdvisory: DEFAULT_REFUND,
    retired: false,
  },
  {
    code: "safety.user-risk",
    parent: "SAFETY",
    label: "Risk to users or marketplace safety",
    sellerExplanation:
      "The listing or related activity may put users or the marketplace at risk.",
    clauseRefs: ["Terms 11", "Terms 14", "AUP 9-12"],
    correction: "Remove the unsafe content or activity and follow any verification request.",
    resubmit: "Resubmission may be unavailable until the safety concern is resolved.",
    appeal: DEFAULT_APPEAL,
    refundAdvisory: DEFAULT_REFUND,
    retired: false,
  },
  {
    code: "account-disabled.enforcement",
    parent: "ACCOUNT_DISABLED",
    label: "Seller account is disabled",
    sellerExplanation:
      "The listing cannot remain active while the seller account is disabled.",
    clauseRefs: ["Terms 15"],
    correction: "Resolve the account restriction before attempting to publish listings.",
    resubmit: "Resubmission is unavailable while the account remains disabled.",
    appeal: DEFAULT_APPEAL,
    refundAdvisory: DEFAULT_REFUND,
    retired: false,
  },
  {
    code: "other.manual-review",
    parent: "OTHER",
    label: "Other issue explained by the moderation team",
    sellerExplanation:
      "The listing needs correction for a reason not covered by the standard categories.",
    clauseRefs: ["Terms 8.3"],
    correction: "Follow the specific correction described in the moderation message.",
    resubmit: "Resubmit after addressing the stated issue.",
    appeal: DEFAULT_APPEAL,
    refundAdvisory: DEFAULT_REFUND,
    retired: false,
  },
  {
    code: "policy.legacy-general",
    parent: "POLICY",
    label: "Legacy general policy issue",
    sellerExplanation:
      "This historical decision used an earlier general policy category.",
    clauseRefs: ["Terms 8", "AUP 14"],
    correction: "Review the policy details supplied with the original decision.",
    resubmit: "Follow the correction instructions in the original decision.",
    appeal: DEFAULT_APPEAL,
    refundAdvisory: DEFAULT_REFUND,
    retired: true,
  },
] as const;

export function getModerationSubReason(
  code: string | null | undefined,
  options: { includeRetired?: boolean } = {},
) {
  const reason = MODERATION_SUB_REASONS.find((entry) => entry.code === code);
  if (!reason || (reason.retired && !options.includeRetired)) return null;
  return reason;
}

export function moderationSubReasonsForParent(
  parent: ListingModerationReason,
  options: { includeRetired?: boolean } = {},
) {
  return MODERATION_SUB_REASONS.filter(
    (entry) =>
      entry.parent === parent &&
      (options.includeRetired === true || !entry.retired),
  );
}

export function moderationReasonLabelForHistory(
  parent: ListingModerationReason,
  subReasonCode?: string | null,
) {
  const subReason = getModerationSubReason(subReasonCode, {
    includeRetired: true,
  });
  return subReason?.parent === parent
    ? subReason.label
    : LISTING_MODERATION_REASON_LABELS[parent];
}

export function buildModerationReasonOptions(
  options: { exclude?: readonly ListingModerationReason[] } = {},
) {
  const excluded = new Set(options.exclude ?? []);
  return LISTING_MODERATION_REASONS.filter(
    (parent) => !excluded.has(parent),
  ).map((parent) => ({
    value: parent,
    label: LISTING_MODERATION_REASON_LABELS[parent],
    subReasons: moderationSubReasonsForParent(parent).map((entry) => ({
      value: entry.code,
      label: entry.label,
      clauseRefs: entry.clauseRefs,
    })),
  }));
}

export function requiresModerationNotes(reason: ListingModerationReason) {
  return REASONS_REQUIRING_NOTES.has(reason);
}

export function validateModerationReason(input: {
  reasonCode?: ListingModerationReason;
  moderationSubReason?: string | null;
  moderationTaxonomyVersion?: string | null;
  notes?: string | null;
  required: boolean;
}) {
  if (!input.required) return null;
  if (!input.reasonCode) return "A reason is required.";
  if (requiresModerationNotes(input.reasonCode) && !input.notes?.trim()) {
    return "Notes are required when the reason is Other.";
  }
  if (input.moderationSubReason || input.moderationTaxonomyVersion) {
    if (
      input.moderationTaxonomyVersion !== MODERATION_TAXONOMY_VERSION
    ) {
      return "The moderation taxonomy version is invalid.";
    }
    const subReason = getModerationSubReason(input.moderationSubReason, {
      includeRetired: true,
    });
    if (!subReason) return "The moderation subreason is invalid.";
    if (subReason.retired) {
      return "The moderation subreason is retired and cannot be used for new decisions.";
    }
    if (subReason.parent !== input.reasonCode) {
      return "The moderation reason and subreason do not match.";
    }
  }
  return null;
}

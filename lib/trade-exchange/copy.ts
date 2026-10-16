export const TRADE_REASON_LABELS: Record<string, string> = {
  ELIGIBILITY: "The business is not eligible for Trade Exchange.",
  EVIDENCE: "More evidence of the business or your authority to act is needed.",
  AUTHORITY: "Authority to act for the business was not confirmed.",
  DUPLICATE: "This registration needs a manual check because it is already in use.",
  POLICY: "The application does not meet iTrader policy.",
  OTHER: "The application needs another review.",
};

export function tradeAccessHeading(input: {
  tier: "STARTER" | "PRO";
  membershipStatus: string;
  proEntitled: boolean;
}): string {
  if (input.membershipStatus === "PENDING") return "Application in review";
  if (input.membershipStatus === "NEEDS_INFO") return "More information needed";
  if (input.membershipStatus === "REJECTED") return "Application not approved";
  if (input.membershipStatus === "SUSPENDED") return "Trade Exchange access is suspended";
  if (input.membershipStatus === "REVOKED") return "Trade Exchange access was revoked";
  if (input.membershipStatus === "APPROVED" && !input.proEntitled) return "Dealer Pro is required";
  if (input.tier === "STARTER") return "Trade Exchange is included with Dealer Pro";
  return "Apply for Trade Exchange";
}

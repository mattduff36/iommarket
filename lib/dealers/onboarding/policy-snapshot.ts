import { policyVersionsForBundle } from "@/lib/policies/registry";

export function buildOnboardingPolicySnapshot(acceptedAt: Date) {
  return {
    acceptedAt: acceptedAt.toISOString(),
    age18: true,
    accountPolicies: ["terms", "acceptable-use", "privacy"],
    dealerPolicies: ["dealer-terms", "acceptable-use", "refunds"],
    versions: {
      AGE_18: policyVersionsForBundle("AGE_18"),
      ACCOUNT_BUNDLE: policyVersionsForBundle("ACCOUNT_BUNDLE"),
      PRIVACY_NOTICE: policyVersionsForBundle("PRIVACY_NOTICE"),
      DEALER_BUNDLE: policyVersionsForBundle("DEALER_BUNDLE"),
    },
  };
}

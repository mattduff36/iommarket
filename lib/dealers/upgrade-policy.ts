import { createHash } from "node:crypto";
import { getPolicyDocument } from "@/lib/policies/loader";
import {
  buildBundleVersion,
  policyVersionsForBundle,
} from "@/lib/policies/registry";
import { POLICY_BUNDLES } from "@/lib/policies/types";

export interface DealerUpgradePolicySnapshot {
  bundleVersion: string;
  policyVersions: Record<string, string>;
  contentHashes: Record<string, string>;
  digest: string;
}

export function buildDealerUpgradePolicySnapshot(): DealerUpgradePolicySnapshot {
  const policyVersions = policyVersionsForBundle("DEALER_BUNDLE") as Record<
    string,
    string
  >;
  const contentHashes = Object.fromEntries(
    POLICY_BUNDLES.DEALER_BUNDLE.map((slug) => {
      const document = getPolicyDocument(slug);
      return [slug, document.contentHash];
    }),
  );
  const bundleVersion = buildBundleVersion("DEALER_BUNDLE");
  const digest = createHash("sha256")
    .update(JSON.stringify({ bundleVersion, policyVersions, contentHashes }), "utf8")
    .digest("hex");

  return { bundleVersion, policyVersions, contentHashes, digest };
}

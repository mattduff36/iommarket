import {
  addDecimalStrings,
  computeUnmarkedGbpMinor,
  multiplyDecimalRatio,
} from "@/lib/costs/money";

export const ITRADER_PROJECT_ID = "itrader";
export const CURSOR_CLIENT_POLICY_VERSION = "itrader-cursor-60-110-v1";
export const CURSOR_LEDGER_CONTRACT_VERSION = "cost-ledger-v1";
export const CURSOR_INCLUDED_POOL_EXPECTATION_USD = "400";

export const ITRADER_CURSOR_POLICY = {
  version: CURSOR_CLIENT_POLICY_VERSION,
  projectId: ITRADER_PROJECT_ID,
  includedNumerator: BigInt(60),
  includedDenominator: BigInt(100),
  onDemandNumerator: BigInt(110),
  onDemandDenominator: BigInt(100),
  exemptFromInfrastructureMarkup: true,
} as const;

export const CURSOR_POLICY_DISCLOSURE =
  "Cursor charges are 60% of included nominal value and 110% of on-demand value. This includes time and has no extra markup.";

export function cursorClientUsd(input: {
  includedNominalUsd: string;
  onDemandUsd: string;
}): string {
  const included = multiplyDecimalRatio(
    input.includedNominalUsd,
    ITRADER_CURSOR_POLICY.includedNumerator,
    ITRADER_CURSOR_POLICY.includedDenominator,
  );
  const onDemand = multiplyDecimalRatio(
    input.onDemandUsd,
    ITRADER_CURSOR_POLICY.onDemandNumerator,
    ITRADER_CURSOR_POLICY.onDemandDenominator,
  );
  return addDecimalStrings([included, onDemand]);
}

export function cursorClientGbpMinor(clientUsd: string, gbpPerUsd: string): bigint {
  return computeUnmarkedGbpMinor(clientUsd, gbpPerUsd);
}

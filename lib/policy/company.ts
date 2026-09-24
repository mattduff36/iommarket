export const COMPANY = {
  legalName: "Code Lab Platforms Limited",
  tradingAs: "iTrader.im",
  companyNumber: "139244C",
  registeredOffice:
    "Ny Croityn, Bay View Road, Port Erin, Isle of Man, IM9 6NA",
  email: "hello@itrader.im",
  policyEffectiveDate: "14 August 2026",
  policyVersion: "2026-08-14.1",
} as const;

export function getDataControllerReference(
  env: Record<string, string | undefined> = process.env,
) {
  const configured = env.NEXT_PUBLIC_IOM_DATA_CONTROLLER_REF?.trim();
  return configured || null;
}

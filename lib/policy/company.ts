export const COMPANY = {
  legalName: "Code Lab Platforms Limited",
  tradingAs: "iTrader.im",
  companyNumber: "139244C",
  registeredOffice:
    "Ny Croityn, Bay View Road, Port Erin, Isle of Man, IM9 6NA",
  email: "hello@itrader.im",
  dataControllerRefPlaceholder: "[Pending Registration Number]",
  policyEffectiveDate: "14 August 2026",
  policyVersion: "2026-08-14.1",
} as const;

export const MARKETPLACE_PUBLIC_PRICES = {
  privateListing: "£4.99",
  featured: "£5.00",
  dealerStarter: "£29.99",
  dealerPro: "£49.99",
} as const;

export function getDataControllerReference(
  env: Record<string, string | undefined> = process.env,
) {
  const configured = env.NEXT_PUBLIC_IOM_DATA_CONTROLLER_REF?.trim();
  return configured || COMPANY.dataControllerRefPlaceholder;
}

export const ONBOARDING_TEST_PROVENANCE_KEY = "dealerOnboardingTest";
export const ONBOARDING_TEST_PROVENANCE_VERSION = 1;

export type OnboardingEnvironment = "preview" | "production";

export interface OnboardingTestAccount {
  key: string;
  environment: OnboardingEnvironment;
  email: string;
  displayName: string;
  previewPackKey: string | null;
}

export const ONBOARDING_TEST_ACCOUNTS = [
  {
    key: "preview-dealer-1",
    environment: "preview",
    email: "previewdealer@itrader.im.preview",
    displayName: "Preview Dealer",
    previewPackKey: "td-car-centre",
  },
  {
    key: "preview-dealer-2",
    environment: "preview",
    email: "previewdealer2@itrader.im.preview",
    displayName: "Preview Dealer 2",
    previewPackKey: "athol-garage",
  },
  {
    key: "preview-dealer-3",
    environment: "preview",
    email: "previewdealer3@itrader.im.preview",
    displayName: "Preview Dealer 3",
    previewPackKey: "mikes-motors",
  },
  {
    key: "preview-dealer-4",
    environment: "preview",
    email: "previewdealer4@itrader.im.preview",
    displayName: "Preview Dealer 4",
    previewPackKey: "rex-motor-company",
  },
  {
    key: "production-dealer",
    environment: "production",
    email: "productiondealer@itrader.im.preview",
    displayName: "Production Dealer",
    previewPackKey: null,
  },
] as const satisfies readonly OnboardingTestAccount[];

export function getOnboardingTestAccount(
  email: string,
  environment: string | undefined,
) {
  const normalized = email.trim().toLowerCase();
  return (
    ONBOARDING_TEST_ACCOUNTS.find(
      (account) =>
        account.environment === environment && account.email === normalized,
    ) ?? null
  );
}

export function onboardingTestEmailsForEnvironment(
  environment: string | undefined,
  enabledPreviewPackKeys: readonly string[],
) {
  if (environment === "production") {
    return ONBOARDING_TEST_ACCOUNTS.filter(
      (account) => account.environment === "production",
    ).map((account) => account.email);
  }
  if (environment !== "preview") return [];
  const enabled = new Set(enabledPreviewPackKeys);
  return ONBOARDING_TEST_ACCOUNTS.filter(
    (account) =>
      account.environment === "preview" &&
      account.previewPackKey !== null &&
      enabled.has(account.previewPackKey),
  ).map((account) => account.email);
}

export function hasOnboardingTestProvenance(
  appMetadata: Record<string, unknown> | undefined,
  account: OnboardingTestAccount,
) {
  const value = appMetadata?.[ONBOARDING_TEST_PROVENANCE_KEY];
  if (!value || typeof value !== "object") return false;
  const provenance = value as Record<string, unknown>;
  return (
    provenance.version === ONBOARDING_TEST_PROVENANCE_VERSION &&
    provenance.environment === account.environment &&
    provenance.key === account.key
  );
}

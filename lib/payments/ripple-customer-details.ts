/**
 * Customer details for Ripple hosted checkout URLs.
 * This module reads a server-only environment variable; do not import it into client code.
 */
export type RippleCustomerDetails = {
  name: string;
  email: string;
};

export type RippleCheckoutPayer = {
  dealerName: string | null;
  accountName: string | null;
  email: string;
};

export function toRippleCheckoutPayer(user: {
  email: string;
  name?: string | null;
  dealerProfile?: { name: string } | null;
}): RippleCheckoutPayer {
  return {
    dealerName: user.dealerProfile?.name ?? null,
    accountName: user.name ?? null,
    email: user.email,
  };
}

function normalizeCheckoutName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (name.length < 2 || name.length > 120) return null;
  if (/[\p{Cc}]/u.test(name)) return null;
  return name;
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/** Dealer business name when it is usable, otherwise the account display name. */
export function resolveRippleCheckoutName(
  dealerName: unknown,
  accountName: unknown,
): string | null {
  return normalizeCheckoutName(dealerName) ?? normalizeCheckoutName(accountName);
}

export function isRippleSkipDetailsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.RIPPLE_SKIP_DETAILS_ENABLED === "0") return false;
  if (env.RIPPLE_SKIP_DETAILS_ENABLED === "1") return true;
  return env.VERCEL_ENV === "production";
}

export function getRippleCustomerDetails(
  payer: RippleCheckoutPayer,
  enabled = isRippleSkipDetailsEnabled(),
): RippleCustomerDetails | null {
  if (!enabled) return null;
  const name = resolveRippleCheckoutName(payer.dealerName, payer.accountName);
  const email = normalizeEmail(payer.email);
  if (!name || !email) return null;
  return { name, email };
}

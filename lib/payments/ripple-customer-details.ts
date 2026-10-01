/**
 * Optional customer details for Ripple hosted checkout URLs.
 * This module reads a server-only environment variable; do not import it into client code.
 */
export type RippleCustomerDetails = {
  name: string;
  email: string;
};

function normalizeRealName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (name.length < 2 || name.length > 120) return null;
  // Require a letter and permit common punctuation used in real names.
  if (!/\p{L}/u.test(name) || !/^[\p{L}\p{M} .'-]+$/u.test(name)) return null;
  return name;
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function getRippleCustomerDetails(
  customerName: unknown,
  customerEmail: unknown,
  enabled = process.env.RIPPLE_SKIP_DETAILS_ENABLED === "1",
): RippleCustomerDetails | null {
  if (!enabled) return null;
  const name = normalizeRealName(customerName);
  const email = normalizeEmail(customerEmail);
  if (!name || !email) return null;
  return { name, email };
}

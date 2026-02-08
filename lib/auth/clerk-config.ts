/**
 * Check whether valid Clerk credentials are configured.
 * Used to gracefully degrade when running without Clerk set up.
 */
export function isClerkConfigured(): boolean {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  // Clerk publishable keys are pk_test_<base64> or pk_live_<base64>, always 40+ chars
  return Boolean(key && /^pk_(test|live)_[A-Za-z0-9]{20,}/.test(key));
}

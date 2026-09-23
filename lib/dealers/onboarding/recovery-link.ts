export function assertSupabaseActionLink(actionLink: string, supabaseUrl: string) {
  let link: URL;
  let allowed: URL;
  try {
    link = new URL(actionLink);
    allowed = new URL(supabaseUrl);
  } catch {
    throw new Error("Recovery link was rejected.");
  }
  if (link.origin !== allowed.origin || link.username || link.password) {
    throw new Error("Recovery link was rejected.");
  }
  if (link.protocol !== "https:" && allowed.protocol !== "http:") {
    throw new Error("Recovery link was rejected.");
  }
  return link.toString();
}

export function buildOnboardingRedirectUrl(origin: string) {
  const redirect = new URL("/auth/callback", origin);
  redirect.searchParams.set("next", "/dealer/onboarding/accept");
  if (redirect.origin !== new URL(origin).origin) {
    throw new Error("Recovery link was rejected.");
  }
  return redirect.toString();
}

export function buildOnboardingRecoveryVerificationUrl(
  redirectTo: string,
  tokenHash: string,
) {
  let callback: URL;
  try {
    callback = new URL(redirectTo);
  } catch {
    throw new Error("Recovery link was rejected.");
  }
  if (
    callback.pathname !== "/auth/callback" ||
    callback.searchParams.get("next") !== "/dealer/onboarding/accept" ||
    callback.username ||
    callback.password ||
    callback.hash ||
    tokenHash.length < 32 ||
    tokenHash.length > 2048 ||
    /[\u0000-\u001f\u007f]/.test(tokenHash)
  ) {
    throw new Error("Recovery link was rejected.");
  }
  const verification = new URL(callback.pathname, callback.origin);
  verification.searchParams.set("token_hash", tokenHash);
  verification.searchParams.set("type", "recovery");
  verification.searchParams.set("next", "/dealer/onboarding/accept");
  return verification.toString();
}

export function buildOnboardingClaimUrl(origin: string, token: string) {
  const claim = new URL("/dealer/onboarding/claim", origin);
  claim.searchParams.set("token", token);
  if (claim.origin !== new URL(origin).origin) {
    throw new Error("Onboarding claim URL was rejected.");
  }
  return claim.toString();
}

export function assertRecoveryRedirectTarget(actionLink: string, expectedRedirectTo: string) {
  let link: URL;
  let expected: URL;
  try {
    link = new URL(actionLink);
    expected = new URL(expectedRedirectTo);
  } catch {
    throw new Error("Recovery link was rejected.");
  }
  const redirectTo = link.searchParams.get("redirect_to");
  if (!redirectTo || expected.username || expected.password) {
    throw new Error("Recovery link was rejected.");
  }
  let actual: URL;
  try {
    actual = new URL(redirectTo);
  } catch {
    throw new Error("Recovery link was rejected.");
  }
  if (
    actual.origin !== expected.origin ||
    actual.pathname !== expected.pathname ||
    actual.searchParams.get("next") !== expected.searchParams.get("next") ||
    actual.username ||
    actual.password ||
    actual.hash
  ) {
    throw new Error("Recovery link was rejected.");
  }
}

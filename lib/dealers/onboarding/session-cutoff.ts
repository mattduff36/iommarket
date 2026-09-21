export const ONBOARDING_SESSION_INVALID_BEFORE = "onboarding_session_invalid_before";

export function readOnboardingSessionInvalidBefore(appMetadata: unknown) {
  if (!appMetadata || typeof appMetadata !== "object") return null;
  const value = (appMetadata as Record<string, unknown>)[ONBOARDING_SESSION_INVALID_BEFORE];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readJwtIssuedAt(accessToken: string | null | undefined) {
  if (!accessToken) return null;
  const segment = accessToken.split(".")[1];
  if (!segment) return null;
  try {
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/")
      + "=".repeat((4 - (segment.length % 4)) % 4);
    const json = JSON.parse(atob(padded)) as { iat?: unknown };
    return typeof json.iat === "number" ? json.iat : null;
  } catch {
    return null;
  }
}

export function isOnboardingSessionStale(
  appMetadata: unknown,
  accessToken: string | null | undefined,
) {
  const invalidBefore = readOnboardingSessionInvalidBefore(appMetadata);
  if (invalidBefore === null) return false;
  const issuedAt = readJwtIssuedAt(accessToken);
  if (issuedAt === null) return true;
  return issuedAt <= invalidBefore;
}

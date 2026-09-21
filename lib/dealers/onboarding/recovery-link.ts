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
  return redirect.toString();
}

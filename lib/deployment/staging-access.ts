import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { isStagingDeployment } from "@/lib/deployment/environment";
import {
  hasStagingAccess, isStagingEntryRequest, isStagingMachineRequest, requiresStagingAdmin,
} from "@/lib/deployment/staging-access-policy";
import { isOnboardingSessionStale, readOnboardingSessionInvalidBefore } from "@/lib/dealers/onboarding/session-cutoff";

function privateResponse(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Robots-Tag", "noindex");
  return response;
}

/** Runs before the legacy launch-cookie bypass and public-path exemptions. */
export async function stagingAccessResponse(request: NextRequest): Promise<NextResponse | null> {
  if (!requiresStagingAdmin()) return null;
  const path = request.nextUrl.pathname;
  const action = request.headers.has("next-action");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!isStagingDeployment() || !url || !key) {
    return privateResponse(NextResponse.json({ error: "Staging access is not configured." }, { status: 503 }));
  }
  if (isStagingEntryRequest(path, request.method, action)) return privateResponse(NextResponse.next());
  if (isStagingMachineRequest(path, request.method, action)) return privateResponse(NextResponse.next());
  const response = NextResponse.next({ request: { headers: request.headers } });
  try {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (values: Array<{ name: string; value: string; options?: Record<string, unknown> }>) => values.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        }),
      },
    });
    const { data: { user } } = await supabase.auth.getUser();
    let stale = false;
    if (user && readOnboardingSessionInvalidBefore(user.app_metadata) !== null) {
      const { data: { session } } = await supabase.auth.getSession();
      stale = isOnboardingSessionStale(user.app_metadata, session?.access_token);
    }
    const account = user && !stale ? await db.user.findUnique({
      where: { authUserId: user.id }, select: { role: true, email: true, disabledAt: true, deletedAt: true },
    }) : null;
    if (hasStagingAccess(account ? {
      ...account,
      verifiedAuthEmail: user?.email_confirmed_at ? user.email ?? null : null,
    } : null)) return privateResponse(response);
    const denied = path.startsWith("/api/") || action || !["GET", "HEAD"].includes(request.method)
      ? NextResponse.json({ error: "Administrator or approved test-account sign-in required." }, { status: user ? 403 : 401 })
      : NextResponse.redirect(new URL("/staging-access", request.url));
    response.cookies.getAll().forEach((cookie) => denied.cookies.set(cookie));
    return privateResponse(denied);
  } catch {
    return privateResponse(NextResponse.json({ error: "Staging access could not be verified." }, { status: 503 }));
  }
}

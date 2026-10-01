import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import {
  isOnboardingSessionStale,
  readOnboardingSessionInvalidBefore,
} from "@/lib/dealers/onboarding/session-cutoff";

export function hasSupabaseAuthCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some(
    (cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("auth-token"),
  );
}

export async function hasConfirmedSupabaseSession(
  request: NextRequest,
  response: NextResponse,
): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey || !hasSupabaseAuthCookie(request)) return false;

  try {
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email_confirmed_at) return false;
    if (readOnboardingSessionInvalidBefore(user.app_metadata) !== null) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (isOnboardingSessionStale(user.app_metadata, session?.access_token)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

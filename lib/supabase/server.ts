import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";

type PendingCookie = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

export function applySupabaseResponseCookies(
  response: NextResponse,
  pendingCookies: readonly PendingCookie[],
) {
  pendingCookies.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });
  return response;
}

/**
 * Create a Supabase server client for use in Server Components, Route Handlers, and Server Actions.
 * Uses Next.js cookies(); in Next.js 15 cookies() is async.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll can throw in Server Component context (read-only); middleware handles write
          }
        },
      },
    }
  );
}

export function createSupabaseRouteHandlerClient(request: NextRequest) {
  const pendingCookies: PendingCookie[] = [];
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: PendingCookie[]) {
          pendingCookies.push(...cookiesToSet);
        },
      },
    },
  );

  return {
    supabase,
    applyCookies(response: NextResponse) {
      return applySupabaseResponseCookies(response, pendingCookies);
    },
  };
}

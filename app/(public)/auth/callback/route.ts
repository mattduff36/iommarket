import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Handles redirect from Supabase after email confirmation or password recovery.
 * Exchanges code for session and redirects to ?next= or /.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const nextUrl = searchParams.get("next") ?? "/";
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(nextUrl, request.url));
    }
  }

  return NextResponse.redirect(new URL("/sign-in?error=callback", request.url));
}

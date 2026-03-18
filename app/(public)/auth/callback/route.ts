import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function getSafeNextPath(nextPath: string | null): string {
  if (!nextPath) return "/";
  if (!nextPath.startsWith("/") || nextPath.startsWith("//")) return "/";
  return nextPath;
}

function getSafeOtpType(type: string | null): EmailOtpType | null {
  if (
    type === "signup" ||
    type === "recovery" ||
    type === "magiclink" ||
    type === "invite" ||
    type === "email_change" ||
    type === "email"
  ) {
    return type;
  }
  return null;
}

/**
 * Handles redirect from Supabase after email confirmation or password recovery.
 * Exchanges code for session and redirects to ?next= or /.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const nextUrl = getSafeNextPath(searchParams.get("next"));
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const otpType = getSafeOtpType(searchParams.get("type"));

  if (tokenHash && otpType) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType,
    });
    if (!error) {
      return NextResponse.redirect(new URL(nextUrl, request.url));
    }
  }

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(nextUrl, request.url));
    }
  }

  const signInUrl = new URL("/sign-in", request.url);
  signInUrl.searchParams.set("error", "callback");
  signInUrl.searchParams.set("next", nextUrl);
  return NextResponse.redirect(signInUrl);
}

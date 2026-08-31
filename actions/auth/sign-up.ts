"use server";

import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAuthConfigured } from "@/lib/auth/supabase-config";
import { buildSignupAcceptanceReceipt } from "@/lib/policy/acceptance";
import { signUpSchema, type SignUpInput } from "@/lib/validations/auth";
import { publicAuthErrorMessage } from "@/lib/forms/action-error";
import { reportHandledException } from "@/lib/monitoring";

function getSafeNextPath(nextPath: string) {
  if (!nextPath.startsWith("/") || nextPath.startsWith("//")) return "/account";
  return nextPath;
}

export async function signUpWithPolicyAcceptance(input: SignUpInput) {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  if (!isSupabaseAuthConfigured()) {
    return { error: "Account sign-up is temporarily unavailable. Please try again shortly." };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  if (!url || !anonKey) {
    return { error: "Account sign-up is temporarily unavailable. Please try again shortly." };
  }

  const nextPath = getSafeNextPath(parsed.data.nextPath);
  const receipt = buildSignupAcceptanceReceipt();

  try {
    const supabase = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: parsed.data.name ? { full_name: parsed.data.name } : {},
        emailRedirectTo: `${appUrl}/auth/callback?next=${encodeURIComponent(nextPath)}`,
      },
    });

    if (error) {
      return {
        error: publicAuthErrorMessage(
          error.message,
          "We could not create your account. Check the highlighted fields and try again.",
        ),
      };
    }
    if (data.user && data.user.identities?.length === 0) {
      return {
        error: "An account with this email already exists. Please sign in instead.",
      };
    }
    if (!data.user) {
      return {
        error: "We could not create your account. Check the highlighted fields and try again.",
      };
    }

    const admin = createSupabaseAdminClient();
    const { error: metadataError } = await admin.auth.admin.updateUserById(
      data.user.id,
      {
        app_metadata: {
          policy_acceptance: receipt,
        },
      },
    );
    if (metadataError) {
      return { error: "Account created, but policy acknowledgement could not be stored. Please accept the policies after sign-in." };
    }

    return { data: { email: parsed.data.email } };
  } catch (err) {
    await reportHandledException({
      error: err,
      action: "signUpWithPolicyAcceptance",
      route: "/sign-up",
    });
    return {
      error: "We could not create your account. Please try again shortly.",
    };
  }
}

"use server";

import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAuthConfigured } from "@/lib/auth/supabase-config";
import { buildSignupAcceptanceReceipt } from "@/lib/policy/acceptance";
import { signUpSchema, type SignUpInput } from "@/lib/validations/auth";

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
    return { error: "Authentication is not configured." };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  if (!url || !anonKey) {
    return { error: "Authentication is not configured." };
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
      return { error: error.message };
    }
    if (data.user && data.user.identities?.length === 0) {
      return {
        error: "An account with this email already exists. Please sign in instead.",
      };
    }
    if (!data.user) {
      return { error: "Unable to create account." };
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
    return {
      error:
        err instanceof Error ? err.message : "Unable to create account right now.",
    };
  }
}

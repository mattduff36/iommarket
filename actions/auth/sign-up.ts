"use server";

import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAuthConfigured } from "@/lib/auth/supabase-config";
import { checkSignupRateLimit } from "@/lib/auth/signup-rate-limit";
import { sendSignupConfirmationEmail } from "@/lib/email/resend";
import { notifyAdminOfNewSignup } from "@/lib/email/signup-notifications";
import { buildSignupAcceptanceReceipt } from "@/lib/policy/acceptance";
import { getCanonicalBaseUrl } from "@/lib/seo/structured-data";
import { signUpSchema, type SignUpInput } from "@/lib/validations/auth";
import { publicAuthErrorMessage } from "@/lib/forms/action-error";
import { supabasePasswordErrorMessage } from "@/lib/forms/password-policy-message";
import { shouldEnforceLaunchGate } from "@/lib/launch/gate";
import { reportHandledException } from "@/lib/monitoring";
import { completeInvitedSignUp } from "@/lib/waitlist/early-access/signup";

function signupProviderError(error: { message: string }) {
  const passwordError = supabasePasswordErrorMessage(error);
  if (passwordError) {
    return { error: { password: [passwordError] } };
  }
  return {
    error: publicAuthErrorMessage(
      error.message,
      "We could not create your account. Please try again shortly.",
    ),
  };
}

function getSafeNextPath(nextPath: string) {
  if (
    !nextPath.startsWith("/") ||
    nextPath.startsWith("//") ||
    nextPath.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(nextPath)
  ) {
    return "/account";
  }
  return nextPath;
}

function buildSignupVerifyUrl(
  appOrigin: string,
  tokenHash: string,
  nextPath: string,
) {
  const verifyUrl = new URL("/auth/callback", appOrigin);
  verifyUrl.searchParams.set("token_hash", tokenHash);
  verifyUrl.searchParams.set("type", "signup");
  verifyUrl.searchParams.set("next", nextPath);
  return verifyUrl.toString();
}

async function getSignupClientAddress() {
  const requestHeaders = await headers();
  return (
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

async function matchesUnconfirmedPassword(email: string, password: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return false;
  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error?.message.toLowerCase().includes("email not confirmed") ?? false;
}

export async function signUpWithPolicyAcceptance(input: SignUpInput) {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  if (!isSupabaseAuthConfigured()) {
    return { error: "Account sign-up is temporarily unavailable. Please try again shortly." };
  }

  if (shouldEnforceLaunchGate()) {
    try {
      return await completeInvitedSignUp(parsed.data, await getSignupClientAddress());
    } catch (err) {
      await reportHandledException({
        error: err,
        action: "signUpWithPolicyAcceptance",
        route: "/sign-up",
      });
      return { error: "We could not create your account. Please try again shortly." };
    }
  }

  if (
    !process.env.RESEND_API_KEY?.trim() ||
    !process.env.RESEND_FROM_EMAIL?.trim()
  ) {
    return { error: "Account sign-up is temporarily unavailable. Please try again shortly." };
  }

  const nextPath = getSafeNextPath(parsed.data.nextPath);
  const receipt = buildSignupAcceptanceReceipt();

  try {
    const clientAddress = await getSignupClientAddress();
    const rateLimit = await checkSignupRateLimit({
      email: parsed.data.email,
      clientAddress,
    });
    if (!rateLimit.allowed) {
      return {
        error: "Too many signup attempts. Please wait a moment and try again.",
      };
    }

    const appOrigin = getCanonicalBaseUrl().origin;
    const admin = createSupabaseAdminClient();
    const userMetadata = { full_name: parsed.data.name };
    const { data: createdData, error: createError } =
      await admin.auth.admin.createUser({
        email: parsed.data.email,
        password: parsed.data.password,
        email_confirm: false,
        user_metadata: userMetadata,
        app_metadata: {
          policy_acceptance: receipt,
        },
      });
    const createdUserId = createError ? null : createdData.user?.id;
    const createdAt = new Date();
    if (!createError && !createdUserId) {
      throw new Error("Supabase returned an incomplete created user.");
    }
    if (createdUserId) {
      await notifyAdminOfNewSignup({
        userId: createdUserId,
        email: parsed.data.email,
        name: parsed.data.name,
        source: "credential",
        createdAt,
      });
    }
    if (createError) {
      const passwordError = supabasePasswordErrorMessage(createError);
      if (passwordError) {
        return { error: { password: [passwordError] } };
      }
      const createMessage = createError.message.toLowerCase();
      const duplicate =
        createMessage.includes("already registered") ||
        createMessage.includes("already been registered");
      if (
        !duplicate ||
        !(await matchesUnconfirmedPassword(
          parsed.data.email,
          parsed.data.password,
        ))
      ) {
        return signupProviderError(createError);
      }
    }
    const { data, error } = await admin.auth.admin.generateLink({
      type: "signup",
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: userMetadata,
        redirectTo: `${appOrigin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
      },
    });

    if (error) {
      return signupProviderError(error);
    }
    if (
      !data.user?.id ||
      !data.properties?.hashed_token ||
      data.properties.verification_type !== "signup"
    ) {
      throw new Error("Supabase returned an incomplete signup link.");
    }

    const { error: userUpdateError } = await admin.auth.admin.updateUserById(
      data.user.id,
      {
        app_metadata: {
          ...(data.user.app_metadata ?? {}),
          policy_acceptance: receipt,
        },
      },
    );
    if (userUpdateError) {
      throw userUpdateError;
    }

    await sendSignupConfirmationEmail({
      to: parsed.data.email,
      verifyUrl: buildSignupVerifyUrl(
        appOrigin,
        data.properties.hashed_token,
        nextPath,
      ),
    });

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

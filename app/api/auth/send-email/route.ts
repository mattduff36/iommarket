import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "standardwebhooks";
import {
  sendSignupConfirmationEmail,
  sendPasswordResetEmail,
  sendEmailChangeEmail,
  sendMagicLinkEmail,
  sendInviteEmail,
} from "@/lib/email/resend";
import { reportHandledException } from "@/lib/monitoring";
import { getCanonicalBaseUrl } from "@/lib/seo/structured-data";

function getHookSecret(): string | null {
  const rawSecret = process.env.SUPABASE_AUTH_HOOK_SECRET?.trim();
  if (!rawSecret) return null;

  // Supabase sends "v1,whsec_<base64>"; standardwebhooks expects the base64 value.
  const secret = rawSecret.replace(/^v1,whsec_/, "");
  try {
    const decoded = Buffer.from(secret, "base64");
    const normalized = secret.replace(/=+$/, "");
    const roundTrip = decoded.toString("base64").replace(/=+$/, "");
    if (decoded.byteLength < 16 || roundTrip !== normalized) return null;
  } catch {
    return null;
  }
  return secret;
}

function getAppOrigin(): string | null {
  try {
    return getCanonicalBaseUrl(
      process.env.NEXT_PUBLIC_APP_URL,
      "production",
      process.env.VERCEL_PROJECT_PRODUCTION_URL,
    ).origin;
  } catch {
    return null;
  }
}

function getSafeNextPath(nextPath: string | null): string {
  if (
    !nextPath ||
    !nextPath.startsWith("/") ||
    nextPath.startsWith("//") ||
    nextPath.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(nextPath)
  ) {
    return "/";
  }
  return nextPath;
}

function buildVerifyUrl(
  tokenHash: string,
  type: string,
  redirectTo: string,
  appOrigin: string,
): string {
  let nextPath = "/";
  try {
    const redirectUrl = new URL(redirectTo);
    if (redirectUrl.origin === appOrigin) {
      nextPath = getSafeNextPath(redirectUrl.searchParams.get("next"));
    }
  } catch {
    // fall through with defaults
  }

  const params = new URLSearchParams({
    token_hash: tokenHash,
    type,
    next: nextPath,
  });
  return `${appOrigin}/auth/callback?${params.toString()}`;
}

export async function POST(req: NextRequest) {
  const payload = await req.text();
  const hookSecret = getHookSecret();

  if (!hookSecret) {
    return NextResponse.json({ error: "Auth email hook unavailable" }, { status: 503 });
  }

  const headers = Object.fromEntries(req.headers.entries());
  try {
    new Webhook(hookSecret).verify(payload, headers);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const appOrigin = getAppOrigin();
  if (!appOrigin) {
    return NextResponse.json({ error: "Auth email hook unavailable" }, { status: 503 });
  }

  let body: {
    user?: { email?: string };
    email_data?: {
      token_hash?: string;
      token_hash_new?: string;
      email_action_type?: string;
      redirect_to?: string;
      new_email?: string;
    };
  };

  try {
    body = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { user, email_data } = body;
  if (!user?.email || !email_data?.token_hash || !email_data?.email_action_type) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const { token_hash, token_hash_new, email_action_type, new_email } = email_data;
  const redirectTo = email_data.redirect_to || `${appOrigin}/auth/callback`;
  const verifyUrl = buildVerifyUrl(
    token_hash,
    email_action_type,
    redirectTo,
    appOrigin,
  );

  try {
    switch (email_action_type) {
      case "signup":
        await sendSignupConfirmationEmail({ to: user.email, verifyUrl });
        break;

      case "recovery":
        await sendPasswordResetEmail({ to: user.email, verifyUrl });
        break;

      case "magiclink":
        await sendMagicLinkEmail({ to: user.email, verifyUrl });
        break;

      case "email_change": {
        const newEmail = new_email ?? "";
        const confirmNewUrl = token_hash_new
          ? buildVerifyUrl(token_hash_new, "email_change", redirectTo, appOrigin)
          : verifyUrl;
        await sendEmailChangeEmail({
          to: user.email,
          newEmail,
          confirmCurrentUrl: verifyUrl,
          confirmNewUrl,
        });
        break;
      }

      case "invite":
        await sendInviteEmail({ to: user.email, verifyUrl });
        break;

      default:
        // Unknown type - return success so Supabase doesn't retry
        break;
    }

    return NextResponse.json({});
  } catch (err) {
    await reportHandledException({
      error: err,
      action: "sendAuthEmail",
      route: "/api/auth/send-email",
      requestPath: "/api/auth/send-email",
      requestMethod: "POST",
    });
    return NextResponse.json({ error: "Failed to send auth email" }, { status: 500 });
  }
}

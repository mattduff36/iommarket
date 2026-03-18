import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "standardwebhooks";
import {
  sendSignupConfirmationEmail,
  sendPasswordResetEmail,
  sendEmailChangeEmail,
  sendMagicLinkEmail,
  sendInviteEmail,
} from "@/lib/email/resend";

// Supabase sends the secret as "v1,whsec_<base64>" — strip the prefix for standardwebhooks
const rawSecret = process.env.SUPABASE_AUTH_HOOK_SECRET ?? "";
const HOOK_SECRET = rawSecret.replace(/^v1,whsec_/, "");

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const APP_ORIGIN = (() => {
  try {
    return new URL(APP_URL).origin;
  } catch {
    return "http://localhost:3000";
  }
})();

function buildVerifyUrl(tokenHash: string, type: string, redirectTo: string): string {
  let origin = APP_ORIGIN;
  let nextPath = "/";
  try {
    const redirectUrl = new URL(redirectTo);
    origin = redirectUrl.origin;
    const nextFromQuery = redirectUrl.searchParams.get("next");
    if (
      nextFromQuery &&
      nextFromQuery.startsWith("/") &&
      !nextFromQuery.startsWith("//")
    ) {
      nextPath = nextFromQuery;
    }
  } catch {
    // fall through with defaults
  }

  const params = new URLSearchParams({
    token_hash: tokenHash,
    type,
    next: nextPath,
  });
  return `${origin}/auth/callback?${params.toString()}`;
}

export async function POST(req: NextRequest) {
  const payload = await req.text();

  if (HOOK_SECRET) {
    const headers = Object.fromEntries(req.headers.entries());
    const wh = new Webhook(HOOK_SECRET);
    try {
      wh.verify(payload, headers);
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
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
  const redirectTo = email_data.redirect_to || `${APP_ORIGIN}/auth/callback`;
  const verifyUrl = buildVerifyUrl(token_hash, email_action_type, redirectTo);

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
          ? buildVerifyUrl(token_hash_new, "email_change", redirectTo)
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
        // Unknown type — return success so Supabase doesn't retry
        break;
    }

    return NextResponse.json({});
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send email";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

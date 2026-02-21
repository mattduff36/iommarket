import { NextRequest, NextResponse } from "next/server";
import {
  sendSignupConfirmationEmail,
  sendPasswordResetEmail,
  sendEmailChangeEmail,
  sendMagicLinkEmail,
  sendInviteEmail,
} from "@/lib/email/resend";

const HOOK_SECRET = process.env.SUPABASE_AUTH_HOOK_SECRET;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

function buildVerifyUrl(tokenHash: string, type: string, redirectTo: string): string {
  const params = new URLSearchParams({
    token: tokenHash,
    type,
    redirect_to: redirectTo,
  });
  return `${SUPABASE_URL}/auth/v1/verify?${params.toString()}`;
}

export async function POST(req: NextRequest) {
  if (HOOK_SECRET) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${HOOK_SECRET}`) {
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
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { user, email_data } = body;
  if (!user?.email || !email_data?.token_hash || !email_data?.email_action_type) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const { token_hash, token_hash_new, email_action_type, new_email } = email_data;
  const redirectTo = email_data.redirect_to || `${APP_URL}/auth/callback`;
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

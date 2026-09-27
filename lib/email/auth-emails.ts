import { sendResendEmail } from "@/lib/email/client";
import { renderBrandedEmail } from "@/lib/email/layout";

export function buildSignupConfirmationEmail(input: { verifyUrl: string }) {
  return {
    subject: "Confirm your iTrader account",
    ...renderBrandedEmail({
      preheader: "Confirm your email to activate your iTrader account.",
      title: "Confirm your email",
      intro: "Welcome to iTrader.im. Confirm your email address to activate your account.",
      actionHref: input.verifyUrl,
      actionLabel: "Confirm email",
      notice:
        "This link expires in 24 hours. If you did not create this account, you can safely ignore this email.",
    }),
  };
}

export function buildPasswordResetEmail(input: { verifyUrl: string }) {
  return {
    subject: "Reset your iTrader password",
    ...renderBrandedEmail({
      preheader: "Reset the password for your iTrader account.",
      title: "Reset your password",
      intro: "A password reset was requested for your iTrader.im account.",
      actionHref: input.verifyUrl,
      actionLabel: "Reset password",
      notice:
        "This link expires in 1 hour. If you did not request a password reset, you can ignore this email.",
    }),
  };
}

export function buildMagicLinkEmail(input: { verifyUrl: string }) {
  return {
    subject: "Your iTrader sign-in link",
    ...renderBrandedEmail({
      preheader: "Use this one-time link to sign in to iTrader.",
      title: "Sign in to iTrader",
      intro: "Use the button below to sign in to your iTrader.im account.",
      actionHref: input.verifyUrl,
      actionLabel: "Sign in to iTrader",
      notice:
        "This link expires in 1 hour and can only be used once. If you did not request it, you can ignore this email.",
    }),
  };
}

export function buildEmailChangeEmail(input: {
  newEmail: string;
  confirmCurrentUrl: string;
  confirmNewUrl: string;
}) {
  return {
    subject: "Confirm your email change",
    ...renderBrandedEmail({
      preheader: "Confirm the email address change for your iTrader account.",
      title: "Confirm your email change",
      intro: "You requested to change the email address on your iTrader.im account.",
      details: [{ label: "New email", value: input.newEmail }],
      paragraphs: [
        "Step 1: confirm this request from your current email address.",
        "Step 2: confirm the separate message sent to your new email address.",
      ],
      actionHref: input.confirmCurrentUrl,
      actionLabel: "Confirm current email",
      secondaryHref: input.confirmNewUrl,
      secondaryLabel: "Confirm new email",
      notice:
        "Both links expire in 24 hours. If you did not request this change, contact hello@itrader.im immediately.",
    }),
  };
}

export function buildInviteEmail(input: { verifyUrl: string }) {
  return {
    subject: "You've been invited to iTrader",
    ...renderBrandedEmail({
      preheader: "Accept your invitation to iTrader.",
      title: "You're invited to iTrader",
      intro: "You have been invited to join iTrader.im. Accept the invitation and set your password.",
      actionHref: input.verifyUrl,
      actionLabel: "Accept invitation",
      notice: "This link expires in 24 hours.",
    }),
  };
}

async function deliver(to: string, email: { subject: string; text: string; html: string }) {
  await sendResendEmail({
    to,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
}

export async function sendSignupConfirmationEmail(params: { to: string; verifyUrl: string }) {
  await deliver(params.to, buildSignupConfirmationEmail(params));
}

export async function sendPasswordResetEmail(params: { to: string; verifyUrl: string }) {
  await deliver(params.to, buildPasswordResetEmail(params));
}

export async function sendMagicLinkEmail(params: { to: string; verifyUrl: string }) {
  await deliver(params.to, buildMagicLinkEmail(params));
}

export async function sendEmailChangeEmail(params: {
  to: string;
  newEmail: string;
  confirmCurrentUrl: string;
  confirmNewUrl: string;
}) {
  await deliver(params.to, buildEmailChangeEmail(params));
}

export async function sendInviteEmail(params: { to: string; verifyUrl: string }) {
  await deliver(params.to, buildInviteEmail(params));
}

import { z } from "zod";
import {
  parseEmailRecipients,
  sendResendEmail,
} from "@/lib/email/client";
import { renderBrandedEmail } from "@/lib/email/layout";
import { reportHandledException } from "@/lib/monitoring";
import { emailField } from "@/lib/validations/email";
import { profileNameSchema } from "@/lib/validations/profile-name";

const signupNotificationSchema = z.object({
  userId: z.string().trim().min(1).max(128),
  email: emailField,
  name: profileNameSchema,
  source: z.enum(["credential", "early_access"]),
  createdAt: z.date(),
});

export type NewSignupNotification = z.infer<
  typeof signupNotificationSchema
>;

function getSignupNotificationRecipients() {
  const configured = parseEmailRecipients(
    process.env.RESEND_SIGNUPS_TO_EMAIL?.trim() ||
      process.env.RESEND_REPORTS_TO_EMAIL,
  );
  return [
    ...new Map(
      configured.flatMap((recipient) => {
        const parsed = emailField.safeParse(recipient);
        return parsed.success
          ? [[parsed.data.toLowerCase(), parsed.data] as const]
          : [];
      }),
    ).values(),
  ];
}

export function buildNewSignupAdminEmail(
  input: NewSignupNotification,
) {
  const parsed = signupNotificationSchema.parse(input);
  const timestamp = parsed.createdAt.toLocaleString("en-GB", {
    timeZone: "UTC",
  });
  const source =
    parsed.source === "early_access"
      ? "Early-access invitation"
      : "Public credential signup";

  return {
    subject: "New iTrader User Signup",
    ...renderBrandedEmail({
      title: "New user signup",
      intro: "A new iTrader account has been created successfully.",
      details: [
        { label: "Name", value: parsed.name },
        { label: "Email", value: parsed.email },
        { label: "Signup source", value: source },
        { label: "Timestamp (UTC)", value: timestamp },
        { label: "Auth user ID", value: parsed.userId },
      ],
    }),
  };
}

export async function sendNewSignupAdminNotificationEmail(
  input: NewSignupNotification,
) {
  const parsed = signupNotificationSchema.parse(input);
  if (
    !process.env.RESEND_API_KEY?.trim() ||
    !process.env.RESEND_FROM_EMAIL?.trim()
  ) {
    throw new Error("Signup notification email provider is not configured.");
  }
  const recipients = getSignupNotificationRecipients();
  if (recipients.length === 0) {
    throw new Error("Signup notification recipient is not configured.");
  }

  const email = buildNewSignupAdminEmail(parsed);
  await sendResendEmail({
    to: recipients,
    subject: email.subject,
    text: email.text,
    html: email.html,
    idempotencyKey: `new-user-signup/${parsed.userId}`,
  });
}

export async function notifyAdminOfNewSignup(
  input: NewSignupNotification,
) {
  try {
    await sendNewSignupAdminNotificationEmail(input);
  } catch (error) {
    await reportHandledException({
      error,
      action: "notifyAdminOfNewSignup",
      route: "/sign-up",
      userId: input.userId,
      userEmail: input.email,
      tags: { signupSource: input.source },
    });
  }
}

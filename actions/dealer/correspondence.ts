"use server";

import { revalidatePath } from "next/cache";
import { hasDealerDashboardAccess } from "@/lib/dealers/access";
import { hasOperationalDealerAccess } from "@/lib/dealers/entitlement";
import { normalizeCorrespondenceEmail } from "@/lib/dealers/correspondence";
import {
  clearCorrespondenceToken,
  confirmCorrespondenceToken,
  deleteCorrespondenceRecord,
  issueCorrespondenceVerification,
  readCorrespondenceByTokenHash,
  readCorrespondenceRecord,
  restoreCorrespondenceRecord,
  writeCorrespondenceRecord,
  type CorrespondenceRecord,
} from "@/lib/dealers/correspondence-store";
import {
  correspondenceTokenMatches,
  hashCorrespondenceToken,
} from "@/lib/dealers/correspondence-token";
import { sendDealerCorrespondenceVerificationEmail } from "@/lib/email/dealer-correspondence";
import { reportHandledException } from "@/lib/monitoring";
import { requireAcceptedAuth } from "@/lib/policy/gate";
import { checkRateLimit } from "@/lib/rate-limit";
import { rateLimitActionError } from "@/lib/rate-limit-result";
import {
  saveDealerCorrespondenceSchema,
  verifyDealerCorrespondenceSchema,
  type SaveDealerCorrespondenceInput,
} from "@/lib/validations/dealer-correspondence";

const LIMIT_MESSAGE = "Too many attempts. Wait a few minutes and try again.";
const SEND_FAILURE =
  "We could not send the confirmation email. Your previous correspondence settings are unchanged.";
const SAME_AS_LOGIN =
  "Choose an email address that is different from the one you use to sign in.";

async function requireCorrespondenceDealer() {
  const user = await requireAcceptedAuth();
  if (!hasDealerDashboardAccess(user)) {
    return { error: "Not authorized to update correspondence settings" };
  }
  if (!(await hasOperationalDealerAccess(user))) {
    return { error: "Active dealer access is required to update correspondence settings" };
  }
  return {
    user: {
      id: user.id,
      email: user.email,
      dealerProfile: {
        id: user.dealerProfile.id,
        name: user.dealerProfile.name,
      },
    },
  };
}

async function limitCorrespondence(
  key: string,
  policy: string,
  maxRequests: number,
) {
  return rateLimitActionError(
    await checkRateLimit(key, { windowMs: 10 * 60_000, maxRequests, policy }),
    LIMIT_MESSAGE,
  );
}

function pendingLinkIsCurrent(
  record: CorrespondenceRecord,
  email: string,
  now: Date,
) {
  return Boolean(
    record.pendingEmail === email &&
      record.verificationTokenHash &&
      record.verificationExpiresAt &&
      record.verificationExpiresAt.getTime() > now.getTime(),
  );
}

async function deliverVerification(input: {
  dealerId: string;
  dealerName: string;
  userId: string;
  previous: CorrespondenceRecord | null;
  next: CorrespondenceRecord;
  token: string;
  action: string;
}) {
  try {
    await writeCorrespondenceRecord(input.dealerId, input.next);
    await sendDealerCorrespondenceVerificationEmail({
      to: input.next.pendingEmail ?? "",
      dealerName: input.dealerName,
      token: input.token,
      expiresAt: input.next.verificationExpiresAt ?? new Date(),
    });
    return { ok: true as const };
  } catch (error) {
    await restoreCorrespondenceRecord(input.dealerId, input.previous).catch(() => undefined);
    await reportHandledException({
      error,
      action: input.action,
      route: "/dealer/dashboard",
      userId: input.userId,
    });
    return { ok: false as const, error: SEND_FAILURE };
  }
}

export async function saveDealerCorrespondenceSettings(
  input: SaveDealerCorrespondenceInput,
) {
  const auth = await requireCorrespondenceDealer();
  if ("error" in auth) return auth;
  const limited = await limitCorrespondence(
    `dealer-correspondence-save:${auth.user.id}`,
    "dealer-correspondence-save",
    8,
  );
  if (limited) return { error: limited };

  const parsed = saveDealerCorrespondenceSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };
  if (parsed.data.email === normalizeCorrespondenceEmail(auth.user.email)) {
    return { error: { email: [SAME_AS_LOGIN] } };
  }

  const dealerId = auth.user.dealerProfile.id;
  const current = await readCorrespondenceRecord(dealerId);
  const now = new Date();
  const preferences = {
    categories: parsed.data.categories,
    copyAssignedToPrimary: parsed.data.copyAssignedToPrimary,
  };

  if (current?.verifiedEmail === parsed.data.email) {
    await writeCorrespondenceRecord(dealerId, {
      ...current,
      ...preferences,
      pendingEmail: null,
      verificationTokenHash: null,
      verificationExpiresAt: null,
    });
    revalidatePath("/dealer/dashboard");
    return { data: { status: "verified" as const, email: parsed.data.email, emailSent: false } };
  }

  if (current && pendingLinkIsCurrent(current, parsed.data.email, now)) {
    await writeCorrespondenceRecord(dealerId, { ...current, ...preferences });
    revalidatePath("/dealer/dashboard");
    return { data: { status: "pending" as const, email: parsed.data.email, emailSent: false } };
  }

  const issued = issueCorrespondenceVerification(parsed.data.email, now);
  const delivered = await deliverVerification({
    dealerId,
    dealerName: auth.user.dealerProfile.name,
    userId: auth.user.id,
    previous: current,
    token: issued.token,
    action: "saveDealerCorrespondenceSettings",
    next: {
      verifiedEmail: current?.verifiedEmail ?? null,
      verifiedAt: current?.verifiedAt ?? null,
      pendingEmail: issued.pendingEmail,
      verificationTokenHash: issued.verificationTokenHash,
      verificationExpiresAt: issued.verificationExpiresAt,
      ...preferences,
    },
  });
  if (!delivered.ok) return { error: delivered.error };
  revalidatePath("/dealer/dashboard");
  return { data: { status: "pending" as const, email: issued.pendingEmail, emailSent: true } };
}

export async function resendDealerCorrespondenceVerification() {
  const auth = await requireCorrespondenceDealer();
  if ("error" in auth) return auth;
  const limited = await limitCorrespondence(
    `dealer-correspondence-resend:${auth.user.id}`,
    "dealer-correspondence-resend",
    3,
  );
  if (limited) return { error: limited };

  const dealerId = auth.user.dealerProfile.id;
  const current = await readCorrespondenceRecord(dealerId);
  if (!current?.pendingEmail) {
    return { error: "There is no correspondence email waiting to be confirmed." };
  }

  const issued = issueCorrespondenceVerification(current.pendingEmail);
  const delivered = await deliverVerification({
    dealerId,
    dealerName: auth.user.dealerProfile.name,
    userId: auth.user.id,
    previous: current,
    token: issued.token,
    action: "resendDealerCorrespondenceVerification",
    next: {
      ...current,
      pendingEmail: issued.pendingEmail,
      verificationTokenHash: issued.verificationTokenHash,
      verificationExpiresAt: issued.verificationExpiresAt,
    },
  });
  if (!delivered.ok) return { error: "We could not send the confirmation email. Try again in a few minutes." };
  revalidatePath("/dealer/dashboard");
  return { data: { status: "pending" as const, email: issued.pendingEmail } };
}

export async function disableDealerCorrespondence() {
  const auth = await requireCorrespondenceDealer();
  if ("error" in auth) return auth;
  const limited = await limitCorrespondence(
    `dealer-correspondence-disable:${auth.user.id}`,
    "dealer-correspondence-disable",
    8,
  );
  if (limited) return { error: limited };

  try {
    await deleteCorrespondenceRecord(auth.user.dealerProfile.id);
  } catch (error) {
    await reportHandledException({
      error,
      action: "disableDealerCorrespondence",
      route: "/dealer/dashboard",
      userId: auth.user.id,
    });
    return { error: "We could not turn off the second email address. Try again." };
  }
  revalidatePath("/dealer/dashboard");
  return { data: { status: "disabled" as const } };
}

export async function verifyDealerCorrespondenceEmail(input: { token: string }) {
  const parsed = verifyDealerCorrespondenceSchema.safeParse(input);
  if (!parsed.success) return { error: "This confirmation link is not valid." };

  const tokenHash = hashCorrespondenceToken(parsed.data.token);
  const limited = await limitCorrespondence(
    `dealer-correspondence-verify:${tokenHash}`,
    "dealer-correspondence-verify",
    8,
  );
  if (limited) return { error: limited };

  const settings = await readCorrespondenceByTokenHash(tokenHash);
  if (
    !settings?.pendingEmail ||
    !settings.verificationTokenHash ||
    !correspondenceTokenMatches(parsed.data.token, settings.verificationTokenHash)
  ) {
    return { error: "This confirmation link is not valid." };
  }
  if (
    !settings.verificationExpiresAt ||
    settings.verificationExpiresAt.getTime() <= Date.now()
  ) {
    return {
      error: "This confirmation link has expired. Send a new one from the dealer dashboard.",
    };
  }

  const pendingEmail = normalizeCorrespondenceEmail(settings.pendingEmail);
  if (pendingEmail === normalizeCorrespondenceEmail(settings.dealer.user.email)) {
    await clearCorrespondenceToken(settings.id, tokenHash);
    return {
      error:
        "This address matches the login email. Choose a different correspondence address from the dealer dashboard.",
    };
  }

  const now = new Date();
  const confirmed = await confirmCorrespondenceToken({
    id: settings.id,
    tokenHash,
    pendingEmail: settings.pendingEmail,
    verifiedEmail: pendingEmail,
    now,
  });
  if (confirmed.count !== 1) return { error: "This confirmation link is not valid." };
  revalidatePath("/dealer/dashboard");
  return { data: { verifiedEmail: pendingEmail } };
}

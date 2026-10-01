import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { shouldEnforceLaunchGate } from "@/lib/launch/gate";
import { getEmailAppOrigin } from "@/lib/email/links";
import { sanitizeEarlyAccessError } from "@/lib/waitlist/early-access/guard";
import {
  buildEarlyAccessClaimUrl,
  EARLY_ACCESS_CLAIM_COOKIE,
  earlyAccessInviteMatches,
  issueEarlyAccessClaimCookie,
  readEarlyAccessClaimCookie,
  signEarlyAccessInvite,
} from "@/lib/waitlist/early-access/tokens";

export { sanitizeEarlyAccessError };

const CLAIMABLE_DELIVERY = new Set(["SENDING", "SENT"]);

type InviteRecord = {
  id: string;
  nonce: string;
  deliveryStatus: string;
  claimedAt: Date | null;
  waitlistUser: { email: string } | null;
  testAdmin: { email: string } | null;
};

export function inviteEmail(record: InviteRecord): string | null {
  return record.waitlistUser?.email ?? record.testAdmin?.email ?? null;
}

export function inviteIsClaimable(record: InviteRecord, proof: string, secret: string | undefined): boolean {
  if (record.claimedAt || !CLAIMABLE_DELIVERY.has(record.deliveryStatus)) return false;
  if (!inviteEmail(record)) return false;
  return earlyAccessInviteMatches(proof, {
    secret,
    recipientId: record.id,
    nonce: record.nonce,
  });
}

export async function findEarlyAccessInvite(recipientId: string) {
  return db.waitlistEarlyAccessRecipient.findUnique({
    where: { id: recipientId },
    include: {
      waitlistUser: { select: { email: true } },
      testAdmin: { select: { email: true } },
    },
  });
}

export async function resolveEarlyAccessInvite(recipientId: string, proof: string) {
  if (!shouldEnforceLaunchGate()) return null;
  const record = await findEarlyAccessInvite(recipientId);
  if (!record || !inviteIsClaimable(record, proof, process.env.DEV_GATE_SECRET)) return null;
  const email = inviteEmail(record);
  if (!email) return null;
  return { recipientId: record.id, email, nonce: record.nonce };
}

export function earlyAccessClaimUrlForRecipient(recipient: {
  id: string;
  nonce: string;
}): string | null {
  const proof = signEarlyAccessInvite({
    secret: process.env.DEV_GATE_SECRET,
    recipientId: recipient.id,
    nonce: recipient.nonce,
  });
  if (!proof) return null;
  return buildEarlyAccessClaimUrl(getEmailAppOrigin(), recipient.id, proof);
}

export async function readVerifiedEarlyAccessClaim() {
  if (!shouldEnforceLaunchGate()) return null;
  const store = await cookies();
  const token = store.get(EARLY_ACCESS_CLAIM_COOKIE)?.value;
  if (!token) return null;
  const recipientId = token.split(".")[2];
  if (!recipientId) return null;
  const record = await findEarlyAccessInvite(recipientId);
  if (!record || record.claimedAt) return null;
  const email = inviteEmail(record);
  if (!email) return null;
  const valid = readEarlyAccessClaimCookie(token, {
    secret: process.env.DEV_GATE_SECRET,
    recipientId: record.id,
    nonce: record.nonce,
  });
  if (!valid) return null;
  return { recipientId: record.id, email, nonce: record.nonce };
}

export function createEarlyAccessClaimCookie(recipientId: string, nonce: string) {
  return issueEarlyAccessClaimCookie({
    secret: process.env.DEV_GATE_SECRET,
    recipientId,
    nonce,
  });
}

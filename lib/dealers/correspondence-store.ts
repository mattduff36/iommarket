import type { DealerEmailCategory } from "@prisma/client";
import { db } from "@/lib/db";
import type { DealerCorrespondenceCategory } from "@/lib/dealers/correspondence";
import {
  CORRESPONDENCE_VERIFICATION_TTL_MS,
  createCorrespondenceToken,
  hashCorrespondenceToken,
} from "@/lib/dealers/correspondence-token";

export interface CorrespondenceRecord {
  verifiedEmail: string | null;
  verifiedAt: Date | null;
  pendingEmail: string | null;
  verificationTokenHash: string | null;
  verificationExpiresAt: Date | null;
  categories: DealerCorrespondenceCategory[];
  copyAssignedToPrimary: boolean;
}

export const CLEARED_CORRESPONDENCE: CorrespondenceRecord = {
  verifiedEmail: null,
  verifiedAt: null,
  pendingEmail: null,
  verificationTokenHash: null,
  verificationExpiresAt: null,
  categories: [],
  copyAssignedToPrimary: false,
};

const recordSelect = {
  verifiedEmail: true,
  verifiedAt: true,
  pendingEmail: true,
  verificationTokenHash: true,
  verificationExpiresAt: true,
  categories: true,
  copyAssignedToPrimary: true,
} as const;

export async function readCorrespondenceRecord(
  dealerId: string,
): Promise<CorrespondenceRecord | null> {
  const row = await db.dealerCorrespondenceSettings.findUnique({
    where: { dealerId },
    select: recordSelect,
  });
  if (!row) return null;
  return row;
}

export async function writeCorrespondenceRecord(
  dealerId: string,
  record: CorrespondenceRecord,
) {
  const data = {
    ...record,
    categories: record.categories as DealerEmailCategory[],
  };
  await db.dealerCorrespondenceSettings.upsert({
    where: { dealerId },
    create: { dealerId, ...data },
    update: data,
  });
}

export async function restoreCorrespondenceRecord(
  dealerId: string,
  previous: CorrespondenceRecord | null,
) {
  if (!previous) {
    await db.dealerCorrespondenceSettings.deleteMany({ where: { dealerId } });
    return;
  }
  await writeCorrespondenceRecord(dealerId, previous);
}

export async function deleteCorrespondenceRecord(dealerId: string) {
  await db.dealerCorrespondenceSettings.deleteMany({ where: { dealerId } });
}

export function issueCorrespondenceVerification(email: string, now = new Date()) {
  const token = createCorrespondenceToken();
  return {
    token,
    pendingEmail: email,
    verificationTokenHash: hashCorrespondenceToken(token),
    verificationExpiresAt: new Date(now.getTime() + CORRESPONDENCE_VERIFICATION_TTL_MS),
  };
}

export async function readCorrespondenceByTokenHash(tokenHash: string) {
  return db.dealerCorrespondenceSettings.findUnique({
    where: { verificationTokenHash: tokenHash },
    select: {
      id: true,
      pendingEmail: true,
      verificationTokenHash: true,
      verificationExpiresAt: true,
      dealer: {
        select: {
          user: { select: { email: true } },
        },
      },
    },
  });
}

export async function clearCorrespondenceToken(id: string, tokenHash: string) {
  return db.dealerCorrespondenceSettings.updateMany({
    where: { id, verificationTokenHash: tokenHash },
    data: {
      pendingEmail: null,
      verificationTokenHash: null,
      verificationExpiresAt: null,
    },
  });
}

export async function confirmCorrespondenceToken(input: {
  id: string;
  tokenHash: string;
  pendingEmail: string;
  verifiedEmail: string;
  now: Date;
}) {
  return db.dealerCorrespondenceSettings.updateMany({
    where: {
      id: input.id,
      verificationTokenHash: input.tokenHash,
      verificationExpiresAt: { gt: input.now },
      pendingEmail: input.pendingEmail,
    },
    data: {
      verifiedEmail: input.verifiedEmail,
      verifiedAt: input.now,
      pendingEmail: null,
      verificationTokenHash: null,
      verificationExpiresAt: null,
    },
  });
}

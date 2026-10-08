"use server";

import { journeyUnknownResult } from "@/lib/forms/journey-public-error";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { logAdminAction } from "@/lib/admin/audit";
import {
  accountProfileChanges,
  adminProfileRevalidationTargets,
  assertProfileWriteAllowlist,
  dealerProfileChanges,
  AdminProfileEditError,
  PROFILE_CONFLICT_MESSAGE,
  PROFILE_DEALER_MISMATCH_MESSAGE,
  PROFILE_DELETED_MESSAGE,
  PROFILE_NO_DEALER_MESSAGE,
  PROFILE_NOT_FOUND_MESSAGE,
  PROFILE_REFRESH_WARNING,
  PROFILE_REGION_MESSAGE,
  profileTargetAllowed,
  sameProfileInstant,
  type AccountProfileWrite,
  type DealerProfileWrite,
  type ProfileChange,
} from "@/lib/admin/profile-edit";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getSampleVisibility,
  type SampleVisibility,
} from "@/lib/listings/sample-visibility";
import { reportHandledException } from "@/lib/monitoring";
import {
  adminProfileEditSchema,
  type AdminProfileEditInput,
} from "@/lib/validations/admin-profile";

export interface AdminProfileEditorData {
  userId: string;
  userUpdatedAt: string;
  account: {
    name: string | null;
    phone: string | null;
    bio: string | null;
    regionId: string | null;
  };
  dealer: null | {
    dealerId: string;
    slug: string;
    updatedAt: string;
    name: string;
    phone: string | null;
    website: string | null;
    bio: string | null;
  };
  unchanged: boolean;
}

type SaveResult =
  | { data: AdminProfileEditorData; warning?: string }
  | { error: string | Record<string, string[]>; conflict?: boolean };

interface LockedUser {
  id: string;
  name: string | null;
  phone: string | null;
  bio: string | null;
  regionId: string | null;
  email: string;
  authUserId: string;
  deletedAt: Date | null;
  updatedAt: Date;
}

interface LockedDealer {
  id: string;
  userId: string;
  name: string;
  slug: string;
  bio: string | null;
  website: string | null;
  phone: string | null;
  isAdminPreview: boolean;
  updatedAt: Date;
}

interface SavedProfile {
  data: AdminProfileEditorData;
  unchanged: boolean;
  userId: string;
  dealerSlug: string | null;
}

export async function saveAdminProfile(input: unknown): Promise<SaveResult> {
  const admin = await requireRole("ADMIN");
  const parsed = adminProfileEditSchema.safeParse(input);
  if (!parsed.success) return { error: fieldErrors(parsed.error) };

  try {
    const sampleVisibility = await getSampleVisibility();
    const saved = await db.$transaction((tx) =>
      saveLockedProfile(tx, {
        adminId: admin.id,
        input: parsed.data,
        sampleVisibility,
      }),
    );
    return finishSave(saved, admin.id);
  } catch (error) {
    const known = asProfileEditError(error);
    if (known) return profileEditResponse(known);
    return journeyUnknownResult({ error, journey: "dealer-admin", action: "saveAdminProfile", route: "/admin/users", kind: "write", userId: admin.id, message: "We could not confirm the profile changes. Reload the account and check before saving again." });
  }
}

async function finishSave(saved: SavedProfile, adminId: string): Promise<SaveResult> {
  if (saved.unchanged) return { data: saved.data };

  try {
    for (const target of adminProfileRevalidationTargets({
      userId: saved.userId,
      dealerSlug: saved.dealerSlug,
    })) {
      if (target.type) revalidatePath(target.path, target.type);
      else revalidatePath(target.path);
    }
  } catch (error) {
    await reportHandledException({
      error,
      action: "saveAdminProfile.revalidate",
      route: `/admin/users/${saved.userId}/profile`,
      userId: adminId,
    });
    return { data: saved.data, warning: PROFILE_REFRESH_WARNING };
  }

  return { data: saved.data };
}

async function saveLockedProfile(
  tx: Prisma.TransactionClient,
  args: {
    adminId: string;
    input: AdminProfileEditInput;
    sampleVisibility: SampleVisibility;
  },
): Promise<SavedProfile> {
  const user = await lockUser(tx, args.input.userId);
  if (!user) throw new AdminProfileEditError("not_found", PROFILE_NOT_FOUND_MESSAGE);
  const dealer = await lockDealer(tx, user.id);
  assertEditableTarget(user, dealer, args.sampleVisibility);
  assertDealerTarget(dealer, args.input);
  assertFreshTimestamps(user, dealer, args.input);

  const userChange = accountProfileChanges(user, args.input.account);
  const dealerChange = dealer
    ? dealerProfileChanges(dealer, args.input.dealer)
    : dealerProfileChanges(
        { name: "", phone: null, website: null, bio: null },
        undefined,
      );
  await assertActiveRegion(tx, userChange.data.regionId);

  const unchanged = userChange.fields.length === 0 && dealerChange.fields.length === 0;
  if (!unchanged) {
    await writeChangedUser(tx, user, userChange);
    await writeChangedDealer(tx, dealer, dealerChange);
    await writeProfileAudits(tx, args.adminId, user.id, dealer?.id ?? null, userChange, dealerChange);
  }

  return readSavedProfile(tx, user.id, dealer?.id ?? null, unchanged);
}

function assertEditableTarget(
  user: LockedUser,
  dealer: LockedDealer | null,
  sampleVisibility: SampleVisibility,
): void {
  const allowed = profileTargetAllowed({
    authUserId: user.authUserId,
    email: user.email,
    hasDealerProfile: dealer !== null,
    isAdminPreview: dealer?.isAdminPreview === true,
    sampleVisibility,
  });
  if (!allowed) throw new AdminProfileEditError("not_found", PROFILE_NOT_FOUND_MESSAGE);
  if (user.deletedAt) throw new AdminProfileEditError("deleted", PROFILE_DELETED_MESSAGE);
}

function assertDealerTarget(dealer: LockedDealer | null, input: AdminProfileEditInput): void {
  if (!input.dealer) return;
  if (!dealer) throw new AdminProfileEditError("no_dealer", PROFILE_NO_DEALER_MESSAGE);
  if (dealer.id !== input.dealer.dealerId || dealer.userId !== input.userId) {
    throw new AdminProfileEditError("dealer_mismatch", PROFILE_DEALER_MISMATCH_MESSAGE);
  }
}

function assertFreshTimestamps(
  user: LockedUser,
  dealer: LockedDealer | null,
  input: AdminProfileEditInput,
): void {
  if (!sameProfileInstant(user.updatedAt, input.expectedUserUpdatedAt)) {
    throw new AdminProfileEditError("conflict", PROFILE_CONFLICT_MESSAGE);
  }
  if (!input.dealer || !dealer) return;
  if (!sameProfileInstant(dealer.updatedAt, input.dealer.expectedDealerUpdatedAt)) {
    throw new AdminProfileEditError("conflict", PROFILE_CONFLICT_MESSAGE);
  }
}

async function assertActiveRegion(
  tx: Prisma.TransactionClient,
  regionId: string | null | undefined,
): Promise<void> {
  if (!regionId) return;
  const region = await tx.region.findFirst({
    where: { id: regionId, active: true },
    select: { id: true },
  });
  if (!region) throw new AdminProfileEditError("invalid_region", PROFILE_REGION_MESSAGE);
}

async function writeChangedUser(
  tx: Prisma.TransactionClient,
  user: LockedUser,
  change: ProfileChange<AccountProfileWrite>,
): Promise<void> {
  if (change.fields.length === 0) return;
  assertProfileWriteAllowlist(change.data, "user");
  const updated = await tx.user.updateMany({
    where: { id: user.id, updatedAt: user.updatedAt },
    data: change.data,
  });
  if (updated.count !== 1) {
    throw new AdminProfileEditError("conflict", PROFILE_CONFLICT_MESSAGE);
  }
}

async function writeChangedDealer(
  tx: Prisma.TransactionClient,
  dealer: LockedDealer | null,
  change: ProfileChange<DealerProfileWrite>,
): Promise<void> {
  if (change.fields.length === 0) return;
  if (!dealer) throw new AdminProfileEditError("no_dealer", PROFILE_NO_DEALER_MESSAGE);
  assertProfileWriteAllowlist(change.data, "dealer");
  const updated = await tx.dealerProfile.updateMany({
    where: { id: dealer.id, userId: dealer.userId, updatedAt: dealer.updatedAt },
    data: change.data,
  });
  if (updated.count !== 1) {
    throw new AdminProfileEditError("conflict", PROFILE_CONFLICT_MESSAGE);
  }
}

async function writeProfileAudits(
  tx: Prisma.TransactionClient,
  adminId: string,
  userId: string,
  dealerId: string | null,
  userChange: ProfileChange<AccountProfileWrite>,
  dealerChange: ProfileChange<DealerProfileWrite>,
): Promise<void> {
  if (userChange.fields.length > 0) {
    await logAdminAction({
      adminId,
      action: "UPDATE_USER_PROFILE",
      entityType: "User",
      entityId: userId,
      details: {
        fields: userChange.fields,
        before: userChange.before,
        after: userChange.after,
      },
    }, tx);
  }
  if (dealerChange.fields.length > 0 && dealerId) {
    await logAdminAction({
      adminId,
      action: "UPDATE_DEALER_PROFILE",
      entityType: "DealerProfile",
      entityId: dealerId,
      details: {
        userId,
        fields: dealerChange.fields,
        before: dealerChange.before,
        after: dealerChange.after,
      },
    }, tx);
  }
}

async function readSavedProfile(
  tx: Prisma.TransactionClient,
  userId: string,
  dealerId: string | null,
  unchanged: boolean,
): Promise<SavedProfile> {
  const savedUser = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, phone: true, bio: true, regionId: true, updatedAt: true },
  });
  if (!savedUser) throw new AdminProfileEditError("not_found", PROFILE_NOT_FOUND_MESSAGE);

  const savedDealer = dealerId
    ? await tx.dealerProfile.findUnique({
        where: { id: dealerId },
        select: {
          id: true,
          name: true,
          slug: true,
          phone: true,
          website: true,
          bio: true,
          updatedAt: true,
        },
      })
    : null;

  return {
    unchanged,
    userId: savedUser.id,
    dealerSlug: savedDealer?.slug ?? null,
    data: {
      userId: savedUser.id,
      userUpdatedAt: savedUser.updatedAt.toISOString(),
      unchanged,
      account: {
        name: savedUser.name,
        phone: savedUser.phone,
        bio: savedUser.bio,
        regionId: savedUser.regionId,
      },
      dealer: savedDealer
        ? {
            dealerId: savedDealer.id,
            slug: savedDealer.slug,
            updatedAt: savedDealer.updatedAt.toISOString(),
            name: savedDealer.name,
            phone: savedDealer.phone,
            website: savedDealer.website,
            bio: savedDealer.bio,
          }
        : null,
    },
  };
}

async function lockUser(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<LockedUser | null> {
  const [row] = await tx.$queryRaw<Array<{
    id: string;
    name: string | null;
    phone: string | null;
    bio: string | null;
    regionId: string | null;
    email: string;
    authUserId: string;
    deletedAt: Date | string | null;
    updatedAt: Date | string;
  }>>`
    SELECT "id", "name", "phone", "bio", "regionId", "email", "authUserId", "deletedAt", "updatedAt"
    FROM "User"
    WHERE "id" = ${userId}
    FOR UPDATE
  `;
  if (!row) return null;
  return {
    ...row,
    deletedAt: row.deletedAt ? asDate(row.deletedAt) : null,
    updatedAt: asDate(row.updatedAt),
  };
}

async function lockDealer(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<LockedDealer | null> {
  const [row] = await tx.$queryRaw<Array<{
    id: string;
    userId: string;
    name: string;
    slug: string;
    bio: string | null;
    website: string | null;
    phone: string | null;
    isAdminPreview: boolean;
    updatedAt: Date | string;
  }>>`
    SELECT "id", "userId", "name", "slug", "bio", "website", "phone", "isAdminPreview", "updatedAt"
    FROM "DealerProfile"
    WHERE "userId" = ${userId}
    FOR UPDATE
  `;
  if (!row) return null;
  return { ...row, updatedAt: asDate(row.updatedAt) };
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function asProfileEditError(error: unknown): AdminProfileEditError | null {
  if (error instanceof AdminProfileEditError) return error;
  if (error instanceof Error && error.cause instanceof AdminProfileEditError) return error.cause;
  return null;
}

function profileEditResponse(error: AdminProfileEditError): SaveResult {
  if (error.code === "invalid_region") {
    return { error: { "account.regionId": [PROFILE_REGION_MESSAGE] } };
  }
  if (error.code === "conflict") return { error: PROFILE_CONFLICT_MESSAGE, conflict: true };
  if (error.code === "not_found") return { error: PROFILE_NOT_FOUND_MESSAGE };
  if (error.code === "deleted") return { error: PROFILE_DELETED_MESSAGE };
  if (error.code === "no_dealer") return { error: PROFILE_NO_DEALER_MESSAGE };
  if (error.code === "dealer_mismatch") return { error: PROFILE_DEALER_MISMATCH_MESSAGE };
  return {
    error: "We couldn't confirm that this profile was saved. Check the profile before trying again.",
  };
}

function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    const message = issue.message.trim();
    if (!message) continue;
    fields[key] = [...(fields[key] ?? []), message];
  }
  return fields;
}

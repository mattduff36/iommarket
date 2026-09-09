import type { Prisma, PrismaClient } from "@prisma/client";
import {
  assertFoundingEmailAllowed,
  FOUNDING_ADMIN_EMAIL,
  FOUNDING_AUTH_METADATA_FLAG,
  FOUNDING_DEALERS,
  type FoundingDealer,
} from "./allowlist";
import { resolveFoundingGrant, type FoundingSubscriptionRow } from "./grant";
import { isPreviewSystemAuthUserId, isPreviewSystemEmail } from "../../lib/preview-packs/safety";
import type { FoundingCredential } from "./manifest";

export interface AuthUserRecord {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

export interface FoundingAuthAdmin {
  auth: {
    admin: {
      listUsers: (args: { page: number; perPage: number }) => Promise<{
        data: { users?: AuthUserRecord[] | null };
        error: { message: string } | null;
      }>;
      createUser: (args: {
        email: string;
        password: string;
        email_confirm: boolean;
        user_metadata: Record<string, unknown>;
      }) => Promise<{ data: { user: AuthUserRecord | null }; error: { message: string } | null }>;
      updateUserById: (
        id: string,
        args: { password: string },
      ) => Promise<{ data: { user: AuthUserRecord | null }; error: { message: string } | null }>;
      deleteUser: (id: string) => Promise<{ error: { message: string } | null }>;
    };
  };
}

export function hasFoundingProvenance(user: AuthUserRecord, dealerKey: string) {
  const metadata = user.user_metadata ?? {};
  return metadata[FOUNDING_AUTH_METADATA_FLAG] === true && metadata.foundingDealerKey === dealerKey;
}

export async function listAuthUsers(admin: FoundingAuthAdmin) {
  const users: AuthUserRecord[] = [];
  let page = 1;
  const perPage = 200;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Failed to list Auth users: ${error.message}`);
    const batch = data.users ?? [];
    users.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }
  return users;
}

export function findAuthUserByEmail(users: AuthUserRecord[], email: string) {
  const needle = email.trim().toLowerCase();
  return users.find((user) => (user.email ?? "").trim().toLowerCase() === needle) ?? null;
}

export function assertReusableAuthUser(input: {
  user: AuthUserRecord;
  dealer: FoundingDealer;
  manifestAuthUserId?: string;
}) {
  const email = input.user.email ?? "";
  assertFoundingEmailAllowed(email);
  if (isPreviewSystemEmail(email) || isPreviewSystemAuthUserId(input.user.id)) {
    throw new Error("Refusing founding onboard: preview-system identity cannot be reused.");
  }
  if (hasFoundingProvenance(input.user, input.dealer.key)) return;
  if (input.manifestAuthUserId && input.manifestAuthUserId === input.user.id) return;
  throw new Error(
    `Refusing founding onboard: existing Auth user ${email} is missing founding provenance.`,
  );
}

export async function ensureFoundingAuthUser(input: {
  admin: FoundingAuthAdmin;
  dealer: FoundingDealer;
  credential: FoundingCredential;
  existing: AuthUserRecord | null;
  manifestAuthUserId?: string;
  rotatePassword?: boolean;
}): Promise<{ user: AuthUserRecord; created: boolean; passwordIssued: boolean }> {
  if (input.existing) {
    assertReusableAuthUser({
      user: input.existing,
      dealer: input.dealer,
      manifestAuthUserId: input.manifestAuthUserId,
    });
    if (input.rotatePassword) {
      const { error } = await input.admin.auth.admin.updateUserById(input.existing.id, {
        password: input.credential.password,
      });
      if (error) {
        throw new Error(`Failed to rotate Auth password for ${input.credential.email}: ${error.message}`);
      }
      return { user: input.existing, created: false, passwordIssued: true };
    }
    return { user: input.existing, created: false, passwordIssued: false };
  }
  const { data, error } = await input.admin.auth.admin.createUser({
    email: input.credential.email,
    password: input.credential.password,
    email_confirm: true,
    user_metadata: {
      full_name: input.dealer.displayName,
      [FOUNDING_AUTH_METADATA_FLAG]: true,
      foundingDealerKey: input.dealer.key,
    },
  });
  if (error || !data.user) {
    throw new Error(`Failed to create Auth user ${input.credential.email}: ${error?.message ?? "unknown"}`);
  }
  return { user: data.user, created: true, passwordIssued: true };
}

export async function loadFoundingAdmin(tx: Prisma.TransactionClient | PrismaClient) {
  const admin = await tx.user.findFirst({
    where: {
      email: { equals: FOUNDING_ADMIN_EMAIL, mode: "insensitive" },
      role: "ADMIN",
      disabledAt: null,
      deletedAt: null,
    },
    select: { id: true, email: true },
  });
  if (!admin) {
    throw new Error(`Refusing founding onboard: ${FOUNDING_ADMIN_EMAIL} is missing.`);
  }
  return admin;
}

export async function assertNoNameCollision(
  tx: Prisma.TransactionClient | PrismaClient,
  dealer: FoundingDealer,
  ownerEmail: string,
) {
  const clash = await tx.dealerProfile.findFirst({
    where: {
      isAdminPreview: false,
      name: { equals: dealer.displayName, mode: "insensitive" },
      user: { email: { not: ownerEmail, mode: "insensitive" } },
    },
    select: { id: true, name: true, user: { select: { email: true } } },
  });
  if (clash) {
    throw new Error(
      `Refusing founding onboard: real dealer "${dealer.displayName}" already exists under another identity.`,
    );
  }
}

export function planFoundingProfile(input: {
  prismaUserId: string;
  dealer: FoundingDealer;
  existing: {
    id: string;
    name: string;
    slug: string;
    website: string | null;
    bio: string | null;
    phone: string | null;
    logoUrl: string | null;
    verified: boolean;
    tier: string;
    isAdminPreview: boolean;
    userId: string;
  } | null;
  paidSubscription?: boolean;
  existingGrant?: FoundingSubscriptionRow | null;
  subscriptions?: FoundingSubscriptionRow[];
  now: Date;
}) {
  if (input.existing?.isAdminPreview) {
    throw new Error("Refusing founding onboard: cannot attach to an admin preview dealer.");
  }
  if (input.existing && input.existing.userId !== input.prismaUserId) {
    throw new Error("Refusing founding onboard: dealer profile is owned by a different user.");
  }
  if (input.existing && input.existing.name.trim() !== input.dealer.displayName) {
    throw new Error("Refusing founding onboard: existing dealer name does not match allowlist.");
  }
  const grant = resolveFoundingGrant({
    subscriptions:
      input.subscriptions ??
      (input.existingGrant
        ? [input.existingGrant]
        : input.paidSubscription
          ? [{ source: "PAYMENT", status: "ACTIVE", grantStartsAt: null, grantEndsAt: null }]
          : []),
    now: input.now,
  });
  return {
    slug: input.existing?.slug ?? `dealer-${input.prismaUserId}`,
    website: input.dealer.website,
    verified: true,
    tier: "PRO" as const,
    bio: input.existing?.bio ?? null,
    phone: input.existing?.phone ?? null,
    logoUrl: input.existing?.logoUrl ?? null,
    grant,
  };
}

export { FOUNDING_DEALERS };

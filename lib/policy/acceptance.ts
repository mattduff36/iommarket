import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  buildBundleVersion,
  policyVersionsForBundle,
} from "@/lib/policies/registry";
import type { PolicyAcceptanceType } from "@/lib/policies/types";
import { getPolicyFlags } from "@/lib/policy/flags";

export const ACCEPTANCE_REQUIRED_REDIRECT = "/account/accept-policies";

const receiptSchema = z.object({
  age18: z.literal(true),
  accountBundle: z.literal(true),
  bundleVersion: z.string().min(1),
  policyVersions: z.record(z.string(), z.string()),
  acceptedAt: z.string().min(1),
});

export type PolicyAcceptanceReceipt = z.infer<typeof receiptSchema>;

export function buildSignupAcceptanceReceipt(): PolicyAcceptanceReceipt {
  return {
    age18: true,
    accountBundle: true,
    bundleVersion: buildBundleVersion("ACCOUNT_BUNDLE"),
    policyVersions: policyVersionsForBundle("ACCOUNT_BUNDLE") as Record<
      string,
      string
    >,
    acceptedAt: new Date().toISOString(),
  };
}

export function parseAcceptanceReceipt(value: unknown) {
  return receiptSchema.safeParse(value);
}

type DbClient = Prisma.TransactionClient | typeof db;

export async function recordAcceptance(
  client: DbClient,
  input: {
    userId: string;
    acceptanceType: PolicyAcceptanceType;
    source: "SIGNUP" | "GATE" | "LISTING" | "SUBSCRIBE";
  },
) {
  const bundleVersion = buildBundleVersion(input.acceptanceType);
  const policyVersions = policyVersionsForBundle(input.acceptanceType);
  return client.policyAcceptance.upsert({
    where: {
      userId_acceptanceType_bundleVersion: {
        userId: input.userId,
        acceptanceType: input.acceptanceType,
        bundleVersion,
      },
    },
    create: {
      userId: input.userId,
      acceptanceType: input.acceptanceType,
      bundleVersion,
      policyVersions,
      source: input.source,
    },
    update: {},
  });
}

export async function importSignupAcceptances(
  client: DbClient,
  userId: string,
  receipt: unknown,
) {
  const parsed = parseAcceptanceReceipt(receipt);
  if (!parsed.success) return { imported: false as const };
  if (parsed.data.bundleVersion !== buildBundleVersion("ACCOUNT_BUNDLE")) {
    return { imported: false as const };
  }

  await recordAcceptance(client, {
    userId,
    acceptanceType: "AGE_18",
    source: "SIGNUP",
  });
  await recordAcceptance(client, {
    userId,
    acceptanceType: "ACCOUNT_BUNDLE",
    source: "SIGNUP",
  });
  await recordAcceptance(client, {
    userId,
    acceptanceType: "PRIVACY_NOTICE",
    source: "SIGNUP",
  });
  return { imported: true as const };
}

export async function hasCurrentAccountAcceptance(userId: string) {
  const [age, account] = await Promise.all([
    db.policyAcceptance.findUnique({
      where: {
        userId_acceptanceType_bundleVersion: {
          userId,
          acceptanceType: "AGE_18",
          bundleVersion: buildBundleVersion("AGE_18"),
        },
      },
      select: { id: true },
    }),
    db.policyAcceptance.findUnique({
      where: {
        userId_acceptanceType_bundleVersion: {
          userId,
          acceptanceType: "ACCOUNT_BUNDLE",
          bundleVersion: buildBundleVersion("ACCOUNT_BUNDLE"),
        },
      },
      select: { id: true },
    }),
  ]);
  return Boolean(age && account);
}

export async function hasCurrentBundleAcceptance(
  userId: string,
  acceptanceType: Exclude<PolicyAcceptanceType, "AGE_18">,
  client: DbClient = db,
) {
  const row = await client.policyAcceptance.findUnique({
    where: {
      userId_acceptanceType_bundleVersion: {
        userId,
        acceptanceType,
        bundleVersion: buildBundleVersion(acceptanceType),
      },
    },
    select: { id: true },
  });
  return Boolean(row);
}

export async function requireBundleAcceptance(
  userId: string,
  acceptanceType: Exclude<PolicyAcceptanceType, "AGE_18">,
) {
  const flags = getPolicyFlags();
  if (!flags.enforceAcceptance) return { ok: true as const };
  try {
    const accepted = await hasCurrentBundleAcceptance(userId, acceptanceType);
    if (!accepted) {
      return {
        ok: false as const,
        reason: "required" as const,
        error: "Current policy acceptance is required for this action.",
      };
    }
    return { ok: true as const };
  } catch {
    return {
      ok: false as const,
      reason: "verification_failed" as const,
      error: "Unable to verify policy acceptance.",
    };
  }
}

export async function requireAccountAcceptance(userId: string) {
  const flags = getPolicyFlags();
  if (!flags.enforceAcceptance) return { ok: true as const };
  try {
    const accepted = await hasCurrentAccountAcceptance(userId);
    if (!accepted) {
      return {
        ok: false as const,
        reason: "required" as const,
        redirectTo: ACCEPTANCE_REQUIRED_REDIRECT,
        error: "Current policy acceptance is required.",
      };
    }
    return { ok: true as const };
  } catch {
    return {
      ok: false as const,
      reason: "verification_failed" as const,
      redirectTo: ACCEPTANCE_REQUIRED_REDIRECT,
      error: "Unable to verify policy acceptance.",
    };
  }
}

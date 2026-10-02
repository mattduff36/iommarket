import { randomBytes, randomUUID } from "node:crypto";
import { db } from "../../lib/db";
import {
  assertDisposableE2EFixtureAllowed,
  isDisposableE2EEmail,
} from "../../lib/ops/safety";
import { recordAcceptance } from "../../lib/policy/acceptance";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";

interface DisposableAccountRecord {
  email: string;
  authUserId: string;
  userId: string | null;
  dealerId: string | null;
}

export interface DisposableAccount {
  email: string;
  password: string;
  userId: string;
  authUserId: string;
  dealerId: string | null;
}

const accounts: DisposableAccountRecord[] = [];
const listingIds: string[] = [];
const savedSearchIds: string[] = [];

function trackedAccount(userId: string) {
  const account = accounts.find((item) => item.userId === userId);
  if (!account || !account.userId || !isDisposableE2EEmail(account.email)) {
    throw new Error("Refusing to seed data for an account this test did not create.");
  }
  return account;
}

async function categoryAndRegion() {
  const [category, region] = await Promise.all([
    db.category.findFirst({
      where: { active: true },
      select: { id: true },
      orderBy: { sortOrder: "asc" },
    }),
    db.region.findFirst({
      where: { active: true },
      select: { id: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);
  if (!category || !region) {
    throw new Error("Disposable fixture setup is missing an active category or region.");
  }
  return { categoryId: category.id, regionId: region.id };
}

export async function createDisposableAccount(
  kind: "member" | "dealer",
): Promise<DisposableAccount> {
  assertDisposableE2EFixtureAllowed();
  const email = `e2e-actions-${kind}-${randomUUID()}@example.com`;
  if (!isDisposableE2EEmail(email)) {
    throw new Error("Generated disposable email was rejected.");
  }
  const generatedCredential = `E2e-${randomBytes(18).toString("base64url")}`;
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    throw new Error("Refusing to reuse an existing account.");
  }

  const created = await createSupabaseAdminClient().auth.admin.createUser({
    email,
    password: generatedCredential,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error(created.error?.message ?? "Could not create the disposable auth user.");
  }

  const record: DisposableAccountRecord = {
    email,
    authUserId: created.data.user.id,
    userId: null,
    dealerId: null,
  };
  accounts.push(record);

  const user = await db.user.create({
    data: {
      authUserId: record.authUserId,
      email,
      name: kind === "dealer" ? "E2E Actions Dealer" : "E2E Actions Member",
      role: kind === "dealer" ? "DEALER" : "USER",
    },
    select: { id: true },
  });
  record.userId = user.id;
  await recordAcceptance(db, {
    userId: user.id,
    acceptanceType: "AGE_18",
    source: "SIGNUP",
  });
  await recordAcceptance(db, {
    userId: user.id,
    acceptanceType: "ACCOUNT_BUNDLE",
    source: "SIGNUP",
  });

  if (kind === "dealer") {
    const dealer = await db.dealerProfile.create({
      data: {
        userId: user.id,
        name: "E2E Actions Dealer",
        slug: `e2e-actions-${randomUUID()}`,
      },
      select: { id: true },
    });
    record.dealerId = dealer.id;
    const endsAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    await db.subscription.create({
      data: {
        dealerId: dealer.id,
        paymentProvider: "ADMIN",
        source: "ADMIN_GRANT",
        status: "ACTIVE",
        grantStartsAt: new Date(),
        grantEndsAt: endsAt,
        currentPeriodEnd: endsAt,
      },
    });
  }

  return {
    email,
    password: generatedCredential,
    userId: user.id,
    authUserId: record.authUserId,
    dealerId: record.dealerId,
  };
}

export async function seedDisposableListing(input: {
  userId: string;
  dealerId?: string | null;
  status: "LIVE" | "PENDING";
  title: string;
}) {
  assertDisposableE2EFixtureAllowed();
  const account = trackedAccount(input.userId);
  if (input.dealerId && input.dealerId !== account.dealerId) {
    throw new Error("Refusing to attach a disposable listing to another dealer.");
  }
  const { categoryId, regionId } = await categoryAndRegion();
  const listing = await db.listing.create({
    data: {
      userId: account.userId!,
      dealerId: input.dealerId ?? null,
      categoryId,
      regionId,
      title: input.title,
      description: "Disposable listing created for the account action smoke test.",
      price: 250_000,
      status: input.status,
      trustDeclarationAccepted: true,
      trustDeclarationAcceptedAt: new Date(),
      expiresAt:
        input.status === "LIVE"
          ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          : null,
    },
    select: { id: true, title: true },
  });
  listingIds.push(listing.id);
  return listing;
}

export async function seedDisposableSavedSearch(input: { userId: string; name: string }) {
  assertDisposableE2EFixtureAllowed();
  const account = trackedAccount(input.userId);
  const saved = await db.savedSearch.create({
    data: {
      userId: account.userId!,
      name: input.name,
      queryParamsJson: { q: "e2e-actions" },
    },
    select: { id: true, name: true },
  });
  savedSearchIds.push(saved.id);
  return saved;
}

export async function cleanupDisposableAccountFixtures() {
  assertDisposableE2EFixtureAllowed();
  const userIds = accounts.flatMap((account) => (account.userId ? [account.userId] : []));
  const userIdSet = new Set(userIds);

  try {
    if (listingIds.length > 0) {
      const listings = await db.listing.findMany({
        where: { id: { in: listingIds } },
        select: { id: true, userId: true },
      });
      if (listings.some((listing) => !userIdSet.has(listing.userId))) {
        throw new Error("Refusing to delete a listing this fixture did not create.");
      }
      await db.listingStatusEvent.deleteMany({ where: { listingId: { in: listingIds } } });
      await db.listing.deleteMany({ where: { id: { in: listingIds } } });
    }

    if (savedSearchIds.length > 0) {
      const searches = await db.savedSearch.findMany({
        where: { id: { in: savedSearchIds } },
        select: { id: true, userId: true },
      });
      if (searches.some((search) => !userIdSet.has(search.userId))) {
        throw new Error("Refusing to delete a saved search this fixture did not create.");
      }
      await db.savedSearch.deleteMany({ where: { id: { in: savedSearchIds } } });
    }

    if (userIds.length > 0) {
      const users = await db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, dealerProfile: { select: { id: true } } },
      });
      if (users.some((user) => !isDisposableE2EEmail(user.email))) {
        throw new Error("Refusing to delete an account outside the disposable fixture.");
      }
      for (const user of users) {
        if (!user.dealerProfile) continue;
        const paymentSubscriptions = await db.subscription.count({
          where: { dealerId: user.dealerProfile.id, source: "PAYMENT" },
        });
        if (paymentSubscriptions > 0) {
          throw new Error("Refusing to delete a dealer that has a payment subscription.");
        }
      }
      await db.policyAcceptance.deleteMany({ where: { userId: { in: userIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    }
  } finally {
    const createdAccounts = accounts.splice(0, accounts.length);
    listingIds.length = 0;
    savedSearchIds.length = 0;
    if (createdAccounts.length > 0) {
      const admin = createSupabaseAdminClient();
      for (const account of createdAccounts) {
        if (!isDisposableE2EEmail(account.email)) continue;
        await admin.auth.admin.deleteUser(account.authUserId);
      }
    }
  }
}

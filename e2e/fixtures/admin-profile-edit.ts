import { randomUUID } from "node:crypto";
import { db } from "../../lib/db";
import { assertDisposableE2EFixtureAllowed } from "../../lib/ops/safety";

const FIXTURE_EMAIL = /^e2e-profile-edit-[0-9a-f-]{36}@example\.com$/i;
const OCEAN_EMAIL = "oceanmotorvillage@itrader.im.preview";

export interface AdminProfileEditFixture {
  email: string;
  userId: string;
  dealerId: string;
  slug: string;
  listingId: string;
  subscriptionId: string;
  accountName: string;
  initialDealerName: string;
}

const created: AdminProfileEditFixture[] = [];

export async function createAdminProfileEditFixture(): Promise<AdminProfileEditFixture> {
  assertDisposableE2EFixtureAllowed();
  const email = `e2e-profile-edit-${randomUUID()}@example.com`;
  assertFixtureEmail(email);
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw new Error("Refusing to reuse an existing account.");

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
    throw new Error("Profile edit fixture is missing an active category or region.");
  }

  const user = await db.user.create({
    data: {
      authUserId: randomUUID(),
      email,
      name: "Account Holder",
      role: "DEALER",
    },
    select: { id: true },
  });
  const slug = `e2e-profile-${randomUUID()}`;
  const dealer = await db.dealerProfile.create({
    data: {
      userId: user.id,
      name: "Ocean Motor Village Preview",
      slug,
      isAdminPreview: false,
      phone: "01624 200000",
      website: "https://www.oceanmotorvillage.com",
    },
    select: { id: true },
  });
  const endsAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const subscription = await db.subscription.create({
    data: {
      dealerId: dealer.id,
      paymentProvider: "ADMIN",
      source: "ADMIN_GRANT",
      status: "ACTIVE",
      grantStartsAt: new Date(),
      grantEndsAt: endsAt,
      currentPeriodEnd: endsAt,
    },
    select: { id: true },
  });
  const listing = await db.listing.create({
    data: {
      userId: user.id,
      dealerId: dealer.id,
      categoryId: category.id,
      regionId: region.id,
      title: `E2E profile seller ${randomUUID()}`,
      description: "Disposable listing for the admin profile editor test.",
      price: 250_000,
      status: "LIVE",
      trustDeclarationAccepted: true,
      trustDeclarationAcceptedAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  });

  const fixture: AdminProfileEditFixture = {
    email,
    userId: user.id,
    dealerId: dealer.id,
    slug,
    listingId: listing.id,
    subscriptionId: subscription.id,
    accountName: "Account Holder",
    initialDealerName: "Ocean Motor Village Preview",
  };
  created.push(fixture);
  return fixture;
}

export async function cleanupAdminProfileEditFixtures(): Promise<void> {
  assertDisposableE2EFixtureAllowed();
  const fixtures = created.splice(0, created.length);
  for (const fixture of fixtures) {
    assertFixtureEmail(fixture.email);
    const user = await db.user.findUnique({
      where: { id: fixture.userId },
      select: { id: true, email: true },
    });
    if (user && user.email !== fixture.email) {
      throw new Error("Refusing to delete a user outside the profile edit fixture.");
    }
    await db.listingStatusEvent.deleteMany({ where: { listingId: fixture.listingId } });
    await db.listing.deleteMany({ where: { id: fixture.listingId, userId: fixture.userId } });
    await db.adminAuditLog.deleteMany({
      where: { entityId: { in: [fixture.userId, fixture.dealerId] } },
    });
    if (user) await db.user.delete({ where: { id: fixture.userId } });
  }
}

function assertFixtureEmail(email: string) {
  if (!FIXTURE_EMAIL.test(email) || email.toLowerCase() === OCEAN_EMAIL) {
    throw new Error("Refusing to use a profile edit fixture that is not disposable.");
  }
}

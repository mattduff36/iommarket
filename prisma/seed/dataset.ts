import { isEvCompatibleFuelType } from "../../lib/constants/fuel-types";
import {
  EXPIRED_COUNT,
  LIVE_COUNT,
  PENDING_COUNT,
  PRO_NEAR_CAP_LIVE,
  REJECTED_COUNT,
  STARTER_CAP_DEALER_LIVE,
  SOLD_COUNT,
  TAKEN_DOWN_COUNT,
  TARGET_EXPIRED_MAX,
  TARGET_EXPIRED_MIN,
  TARGET_LIVE_MAX,
  TARGET_LIVE_MIN,
  TARGET_PRO_DEALERS,
  TARGET_PUBLIC_DEALERS,
  TARGET_SOLD_MAX,
  TARGET_SOLD_MIN,
  TARGET_STARTER_DEALERS,
} from "./constants";
import { assertDealerCaps } from "./caps";
import { isPublicDealerEntitled } from "./entitlement";
import {
  assertSyntheticFinancialRow,
  seedPaymentId,
  seedPaymentReference,
  seedPlanId,
  seedSubscriptionId,
} from "./payments";
import {
  IOM_REGION_SLUGS,
  LISTING_IMAGES,
  VEHICLE_TEMPLATES,
  type VehicleCategory,
} from "./vehicles";

export type DealerTier = "STARTER" | "PRO";
export type ListingStatus =
  | "DRAFT"
  | "PENDING"
  | "APPROVED"
  | "LIVE"
  | "EXPIRED"
  | "TAKEN_DOWN"
  | "SOLD"
  | "REJECTED";

export interface PreservedDealerInput {
  userId: string;
  dealerId: string;
  slug: string;
  name: string;
  tier: DealerTier;
  verified: boolean;
}

export interface PreservedUserInput {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

export interface PlannedDealer {
  key: string;
  authUserId: string;
  email: string;
  userName: string;
  name: string;
  slug: string;
  bio: string;
  phone: string;
  website: string;
  verified: boolean;
  tier: DealerTier;
  entitlement: "PAYMENT" | "ADMIN_GRANT";
  preservedUserId?: string;
  preservedDealerId?: string;
}

export interface PlannedSeller {
  key: string;
  authUserId: string;
  email: string;
  name: string;
  preservedUserId?: string;
}

export interface PlannedListing {
  key: string;
  title: string;
  description: string;
  category: VehicleCategory;
  regionSlug: string;
  pricePence: number;
  status: ListingStatus;
  featured: boolean;
  daysAgo: number;
  dealerKey?: string;
  sellerKey: string;
  attributes: Record<string, string>;
  imageUrls: string[];
}

export interface PlannedReview {
  dealerKey: string;
  reviewerKey: string;
  rating: number;
  comment: string;
  status: "APPROVED" | "PENDING" | "HIDDEN";
}

export interface MarketplacePlan {
  version: string;
  dealers: PlannedDealer[];
  sellers: PlannedSeller[];
  listings: PlannedListing[];
  reviews: PlannedReview[];
}

const FICTIONAL_DEALERS: Array<Omit<PlannedDealer, "tier" | "entitlement" | "verified">> = [
  { key: "manx-motors", authUserId: "00000000-0000-0000-0000-000000000101", email: "info@manxmotors.im", userName: "Manx Motors Ltd", name: "Manx Motors Ltd", slug: "manx-motors", bio: "Douglas showroom with island-wide used cars, vans, and part-exchange.", phone: "01624 612345", website: "https://manxmotors.example.im" },
  { key: "ramsey-motors", authUserId: "00000000-0000-0000-0000-000000000102", email: "info@ramseymotors.im", userName: "Ramsey Motor Company", name: "Ramsey Motor Company", slug: "ramsey-motors", bio: "Family-run north-of-island dealer specialising in quality used cars.", phone: "01624 813456", website: "https://ramseymotors.example.im" },
  { key: "douglas-auto", authUserId: "00000000-0000-0000-0000-000000000103", email: "sales@douglasauto.im", userName: "Douglas Auto Exchange", name: "Douglas Auto Exchange", slug: "douglas-auto", bio: "Peel Road stock across cars, vans, and 4x4s.", phone: "01624 671234", website: "https://douglasauto.example.im" },
  { key: "peel-road-cars", authUserId: "00000000-0000-0000-0000-000000000104", email: "hello@peelroadcars.im", userName: "Peel Road Cars", name: "Peel Road Cars", slug: "peel-road-cars", bio: "West-coast independents with finance and warranty options.", phone: "01624 844210", website: "https://peelroadcars.example.im" },
  { key: "onchan-motors", authUserId: "00000000-0000-0000-0000-000000000105", email: "sales@onchanmotors.im", userName: "Onchan Motors", name: "Onchan Motors", slug: "onchan-motors", bio: "Compact town-centre stock for first cars and commuters.", phone: "01624 628901", website: "https://onchanmotors.example.im" },
  { key: "castletown-cars", authUserId: "00000000-0000-0000-0000-000000000106", email: "info@castletowncars.im", userName: "Castletown Cars", name: "Castletown Cars", slug: "castletown-cars", bio: "Southern dealership with family SUVs and estates.", phone: "01624 822440", website: "https://castletowncars.example.im" },
  { key: "laxey-garage", authUserId: "00000000-0000-0000-0000-000000000107", email: "workshop@laxeygarage.im", userName: "Laxey Garage", name: "Laxey Garage", slug: "laxey-garage", bio: "East-coast workshop-turned-dealer with serviced stock.", phone: "01624 861122", website: "https://laxeygarage.example.im" },
  { key: "southern-autos", authUserId: "00000000-0000-0000-0000-000000000108", email: "sales@southernautos.im", userName: "Southern Autos", name: "Southern Autos", slug: "southern-autos", bio: "Port Erin based used cars and light commercials.", phone: "01624 833700", website: "https://southernautos.example.im" },
  { key: "northern-motors", authUserId: "00000000-0000-0000-0000-000000000109", email: "info@northernmotors.im", userName: "Northern Motors", name: "Northern Motors", slug: "northern-motors", bio: "Jurby and Ramsey coverage for cars and vans.", phone: "01624 897300", website: "https://northernmotors.example.im" },
  { key: "island-4x4", authUserId: "00000000-0000-0000-0000-000000000110", email: "sales@island4x4.im", userName: "Island 4x4", name: "Island 4x4", slug: "island-4x4", bio: "Land Rovers, pickups, and all-weather island vehicles.", phone: "01624 664880", website: "https://island4x4.example.im" },
  { key: "tt-bikes", authUserId: "00000000-0000-0000-0000-000000000111", email: "sales@ttbikes.im", userName: "TT Bikes", name: "TT Bikes", slug: "tt-bikes", bio: "Motorcycles and commuter bikes for the TT island.", phone: "01624 618200", website: "https://ttbikes.example.im" },
  { key: "ayre-vans", authUserId: "00000000-0000-0000-0000-000000000112", email: "hire@ayrevans.im", userName: "Ayre Vans", name: "Ayre Vans", slug: "ayre-vans", bio: "Commercial vans for trades across the north.", phone: "01624 880441", website: "https://ayrevans.example.im" },
];

const FICTIONAL_SELLERS: PlannedSeller[] = [
  { key: "john-quayle", authUserId: "00000000-0000-0000-0000-000000000201", email: "john.quayle@example.im", name: "John Quayle" },
  { key: "sarah-craine", authUserId: "00000000-0000-0000-0000-000000000202", email: "sarah.craine@example.im", name: "Sarah Craine" },
  { key: "mark-kelly", authUserId: "00000000-0000-0000-0000-000000000203", email: "mark.kelly@example.im", name: "Mark Kelly" },
  { key: "emma-corlett", authUserId: "00000000-0000-0000-0000-000000000204", email: "emma.corlett@example.im", name: "Emma Corlett" },
  { key: "david-shimmin", authUserId: "00000000-0000-0000-0000-000000000205", email: "david.shimmin@example.im", name: "David Shimmin" },
  { key: "fiona-clague", authUserId: "00000000-0000-0000-0000-000000000206", email: "fiona.clague@example.im", name: "Fiona Clague" },
  { key: "tom-kewley", authUserId: "00000000-0000-0000-0000-000000000207", email: "tom.kewley@example.im", name: "Tom Kewley" },
  { key: "anna-moore", authUserId: "00000000-0000-0000-0000-000000000208", email: "anna.moore@example.im", name: "Anna Moore" },
];

function slugKey(slug: string) {
  return slug.replace(/[^a-z0-9]+/g, "-");
}

function pad(value: number) {
  return String(value).padStart(3, "0");
}

function templateAt(index: number) {
  return VEHICLE_TEMPLATES[index % VEHICLE_TEMPLATES.length];
}

function buildAttributes(
  template: (typeof VEHICLE_TEMPLATES)[number],
  index: number,
  regionSlug: string,
): Record<string, string> {
  const year = String(2014 + (index % 11));
  const mileage = String(8000 + ((index * 3700) % 92000));
  const writtenOff = index % 23 === 0;
  const writeOffCategory = writtenOff ? (index % 2 === 0 ? "Category N" : "Category S") : "None";
  const electric = isEvCompatibleFuelType(template.fuel);
  const attributes: Record<string, string> = {
    make: template.make,
    model: template.model,
    year,
    mileage,
    "fuel-type": template.fuel,
    transmission: template.transmission,
    colour: ["Black", "White", "Silver", "Grey", "Blue", "Red"][index % 6],
    location: regionSlug === "uk" ? "UK" : "Isle of Man",
    "previously-written-off": writtenOff ? "true" : "false",
    "write-off-category": writeOffCategory,
    "engine-power": String(90 + ((index * 13) % 250)),
    "tax-per-year": electric ? "0" : String(30 + ((index * 17) % 360)),
    "insurance-group": String(8 + (index % 32)),
  };
  if (template.bodyType) attributes["body-type"] = template.bodyType;
  if (template.category !== "motorbike") {
    attributes.doors = template.category === "van" ? "4" : "5";
    attributes.seats = template.category === "motorhome" ? "4" : "5";
    attributes["boot-space"] = String(280 + ((index * 40) % 900));
    attributes["drive-type"] = index % 7 === 0 ? "AWD" : "FWD";
  } else {
    attributes.seats = "2";
    attributes["drive-type"] = "RWD";
  }
  if (electric) {
    attributes["battery-range"] = String(180 + ((index * 11) % 160));
    attributes["charging-time"] = String(40 + ((index * 7) % 200));
  } else {
    attributes["engine-size"] = String(10 + (index % 25));
    attributes["fuel-consumption"] = String(38 + (index % 30));
    attributes["co2-emissions"] = String(90 + ((index * 9) % 120));
  }
  return attributes;
}

function buildListing(input: {
  key: string;
  index: number;
  status: ListingStatus;
  sellerKey: string;
  dealerKey?: string;
  featured?: boolean;
}): PlannedListing {
  const template = templateAt(input.index);
  const regionSlug =
    input.index % 11 === 0 ? "uk" : IOM_REGION_SLUGS[input.index % IOM_REGION_SLUGS.length];
  const imageCount = 1 + (input.index % 3);
  return {
    key: input.key,
    title: `${2014 + (input.index % 11)} ${template.make} ${template.model}`,
    description: `${template.make} ${template.model} in strong condition for island use. Service history available, recently inspected, and priced for a quick local sale.`,
    category: template.category,
    regionSlug,
    pricePence: Math.round(template.pricePounds * 100),
    status: input.status,
    featured: input.featured ?? input.index % 17 === 0,
    daysAgo: 1 + (input.index % 40),
    dealerKey: input.dealerKey,
    sellerKey: input.sellerKey,
    attributes: buildAttributes(template, input.index, regionSlug),
    imageUrls: Array.from({ length: imageCount }, (_, offset) =>
      LISTING_IMAGES[(input.index + offset) % LISTING_IMAGES.length],
    ),
  };
}

function buildPublicDealers(
  preservedDealers: readonly PreservedDealerInput[],
  preservedEmails: readonly string[],
): PlannedDealer[] {
  const needed = Math.max(0, TARGET_PUBLIC_DEALERS - preservedDealers.length);
  const usedSlugs = new Set(preservedDealers.map((dealer) => dealer.slug));
  const usedEmails = new Set(preservedEmails);
  const preserved = preservedDealers.map((dealer, index) => ({
    key: `preserved-${slugKey(dealer.slug) || index}`,
    authUserId: "",
    email: "",
    userName: dealer.name,
    name: dealer.name,
    slug: dealer.slug,
    bio: `${dealer.name} is an established Isle of Man dealer with current stock and an active profile.`,
    phone: "01624 600000",
    website: `https://${dealer.slug}.example.im`,
    verified: dealer.verified,
    tier: dealer.tier,
    entitlement: index === 0 ? ("ADMIN_GRANT" as const) : ("PAYMENT" as const),
    preservedUserId: dealer.userId,
    preservedDealerId: dealer.dealerId,
  }));

  const preservedPro = preserved.filter((dealer) => dealer.tier === "PRO").length;
  const preservedStarter = preserved.filter((dealer) => dealer.tier === "STARTER").length;
  let remainingPro = Math.max(0, TARGET_PRO_DEALERS - preservedPro);
  let remainingStarter = Math.max(0, TARGET_STARTER_DEALERS - preservedStarter);

  const fictional = FICTIONAL_DEALERS.filter(
    (dealer) => !usedSlugs.has(dealer.slug) && !usedEmails.has(dealer.email),
  )
    .slice(0, needed)
    .map((dealer, index) => {
    let tier: DealerTier = "STARTER";
    if (remainingPro > 0) {
      tier = "PRO";
      remainingPro -= 1;
    } else if (remainingStarter > 0) {
      remainingStarter -= 1;
    }
    return {
      ...dealer,
      tier,
      entitlement: "PAYMENT" as const,
      verified: index !== 2,
    };
  });

  return [...preserved, ...fictional];
}

function liveAllocations(dealers: PlannedDealer[]) {
  const starter = dealers.filter((dealer) => dealer.tier === "STARTER");
  const pro = dealers.filter((dealer) => dealer.tier === "PRO");
  const allocations = new Map<string, number>();
  if (starter[0]) allocations.set(starter[0].key, STARTER_CAP_DEALER_LIVE);
  if (pro[0]) allocations.set(pro[0].key, PRO_NEAR_CAP_LIVE);
  starter.slice(1).forEach((dealer, index) => {
    allocations.set(dealer.key, 4 + (index % 2));
  });
  pro.slice(1).forEach((dealer, index) => {
    allocations.set(dealer.key, 7 + (index % 2));
  });
  return allocations;
}

function buildListings(
  dealers: PlannedDealer[],
  sellers: PlannedSeller[],
  preservedUsers: readonly PreservedUserInput[],
): PlannedListing[] {
  const listings: PlannedListing[] = [];
  const allocations = liveAllocations(dealers);
  let index = 0;

  for (const dealer of dealers) {
    const count = allocations.get(dealer.key) ?? 4;
    for (let offset = 0; offset < count; offset += 1) {
      listings.push(
        buildListing({
          key: `live-d-${dealer.key}-${pad(offset)}`,
          index,
          status: "LIVE",
          sellerKey: dealer.key,
          dealerKey: dealer.key,
          featured: offset === 0,
        }),
      );
      index += 1;
    }
  }

  const privateLiveNeeded = LIVE_COUNT - listings.length;
  for (let offset = 0; offset < privateLiveNeeded; offset += 1) {
    listings.push(
      buildListing({
        key: `live-p-${pad(offset)}`,
        index,
        status: "LIVE",
        sellerKey: sellers[offset % sellers.length].key,
      }),
    );
    index += 1;
  }

  const extras: Array<{ count: number; status: ListingStatus; prefix: string }> = [
    { count: SOLD_COUNT, status: "SOLD", prefix: "sold" },
    { count: EXPIRED_COUNT, status: "EXPIRED", prefix: "expired" },
    { count: PENDING_COUNT, status: "PENDING", prefix: "pending" },
    { count: TAKEN_DOWN_COUNT, status: "TAKEN_DOWN", prefix: "taken" },
    { count: REJECTED_COUNT, status: "REJECTED", prefix: "rejected" },
  ];
  for (const extra of extras) {
    for (let offset = 0; offset < extra.count; offset += 1) {
      listings.push(
        buildListing({
          key: `${extra.prefix}-${pad(offset)}`,
          index,
          status: extra.status,
          sellerKey: sellers[offset % sellers.length].key,
        }),
      );
      index += 1;
    }
  }

  const draftOwner =
    preservedUsers.find((user) => user.role === "USER") ??
    preservedUsers[0] ??
    null;
  listings.push(
    buildListing({
      key: "draft-001",
      index,
      status: "DRAFT",
      sellerKey: draftOwner ? `preserved-user-${draftOwner.id}` : sellers[0].key,
    }),
  );

  return listings;
}

function buildSellers(
  preservedUsers: readonly PreservedUserInput[],
): PlannedSeller[] {
  const preservedSellers = preservedUsers
    .filter((user) => user.role === "USER")
    .map((user) => ({
      key: `preserved-user-${user.id}`,
      authUserId: "",
      email: user.email,
      name: user.name ?? user.email,
      preservedUserId: user.id,
    }));
  return [...preservedSellers, ...FICTIONAL_SELLERS];
}

function buildReviews(dealers: PlannedDealer[], sellers: PlannedSeller[]): PlannedReview[] {
  const reviewerPool = sellers.filter((seller) => !seller.key.startsWith("preserved-"));
  const reviews: PlannedReview[] = dealers.map((dealer, index) => ({
    dealerKey: dealer.key,
    reviewerKey: reviewerPool[index % reviewerPool.length].key,
    rating: 4 + (index % 2),
    comment: `Straightforward viewing at ${dealer.name}. Vehicle matched the advert.`,
    status: "APPROVED" as const,
  }));
  reviews[0] = { ...reviews[0], status: "APPROVED" };
  reviews.push({
    dealerKey: dealers[0].key,
    reviewerKey: reviewerPool[1 % reviewerPool.length].key,
    rating: 3,
    comment: "Waiting for a callback after the test drive.",
    status: "PENDING",
  });
  reviews.push({
    dealerKey: dealers[1]?.key ?? dealers[0].key,
    reviewerKey: reviewerPool[2 % reviewerPool.length].key,
    rating: 1,
    comment: "Removed after moderation.",
    status: "HIDDEN",
  });
  return reviews;
}

export function buildMarketplacePlan(input: {
  preservedDealers: readonly PreservedDealerInput[];
  preservedUsers: readonly PreservedUserInput[];
  now: Date;
}): MarketplacePlan {
  const dealers = buildPublicDealers(
    input.preservedDealers,
    input.preservedUsers.map((user) => user.email),
  );
  const sellers = buildSellers(input.preservedUsers);
  const listings = buildListings(dealers, sellers, input.preservedUsers);
  const reviews = buildReviews(dealers, sellers);
  const plan = {
    version: "DEMO-SEED-4A91C2.1",
    dealers,
    sellers,
    listings,
    reviews,
  };
  assertMarketplacePlan(plan, input.now);
  return plan;
}

export function assertMarketplacePlan(plan: MarketplacePlan, now: Date) {
  const live = plan.listings.filter((listing) => listing.status === "LIVE").length;
  const sold = plan.listings.filter((listing) => listing.status === "SOLD").length;
  const expired = plan.listings.filter((listing) => listing.status === "EXPIRED").length;
  const pending = plan.listings.filter((listing) => listing.status === "PENDING").length;
  if (live < TARGET_LIVE_MIN || live > TARGET_LIVE_MAX) {
    throw new Error(`LIVE count ${live} is outside ${TARGET_LIVE_MIN}-${TARGET_LIVE_MAX}.`);
  }
  if (sold < TARGET_SOLD_MIN || sold > TARGET_SOLD_MAX) {
    throw new Error(`SOLD count ${sold} is outside ${TARGET_SOLD_MIN}-${TARGET_SOLD_MAX}.`);
  }
  if (expired < TARGET_EXPIRED_MIN || expired > TARGET_EXPIRED_MAX) {
    throw new Error(`EXPIRED count ${expired} is outside ${TARGET_EXPIRED_MIN}-${TARGET_EXPIRED_MAX}.`);
  }
  if (pending < 1) throw new Error("Dataset must include PENDING listings.");
  if (!plan.listings.some((listing) => listing.status === "DRAFT")) {
    throw new Error("Dataset must include a DRAFT listing.");
  }
  if (!plan.reviews.some((review) => review.status === "APPROVED")) {
    throw new Error("Dataset must include an approved review.");
  }
  assertDealerCaps(plan.dealers, plan.listings);

  if (plan.dealers.length === TARGET_PUBLIC_DEALERS) {
    const pro = plan.dealers.filter((dealer) => dealer.tier === "PRO").length;
    const starter = plan.dealers.filter((dealer) => dealer.tier === "STARTER").length;
    if (pro !== TARGET_PRO_DEALERS || starter !== TARGET_STARTER_DEALERS) {
      throw new Error(`Expected ${TARGET_PRO_DEALERS} PRO and ${TARGET_STARTER_DEALERS} STARTER dealers.`);
    }
  }
  if (
    plan.dealers.some((dealer) => !dealer.preservedUserId) &&
    !plan.dealers.some((dealer) => !dealer.verified)
  ) {
    throw new Error("Dataset must include one unverified public dealer.");
  }

  for (const dealer of plan.dealers) {
    const paid = dealer.entitlement === "PAYMENT";
    const entitled = isPublicDealerEntitled(
      [
        paid
          ? {
              source: "PAYMENT",
              status: "ACTIVE",
              currentPeriodEnd: new Date(now.getTime() + 90 * 86_400_000),
            }
          : {
              source: "ADMIN_GRANT",
              status: "ACTIVE",
              currentPeriodEnd: new Date(now.getTime() + 90 * 86_400_000),
              revokedAt: null,
              grantStartsAt: now,
              grantEndsAt: new Date(now.getTime() + 90 * 86_400_000),
            },
      ],
      now,
    );
    if (!entitled) throw new Error(`Dealer ${dealer.key} is not entitled.`);
    assertSyntheticFinancialRow({
      paymentProvider: "DEV",
      providerSubscriptionId: seedSubscriptionId(dealer.slug),
      providerPlanId: seedPlanId(dealer.tier),
      customerEmailNorm: null,
    });
  }

  const paidListing = plan.listings.find((listing) => listing.status !== "DRAFT");
  if (paidListing) {
    assertSyntheticFinancialRow({
      paymentProvider: "DEV",
      providerPaymentId: seedPaymentId(paidListing.key),
      providerReference: seedPaymentReference(paidListing.key),
      customerEmailNorm: null,
    });
  }
}

import { isEvCompatibleFuelType } from "../../lib/constants/fuel-types";
import {
  DATASET_VERSION,
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
  TARGET_PRIVATE_SELLERS,
  TARGET_PRO_DEALERS,
  TARGET_PUBLIC_DEALERS,
  TARGET_SOLD_MAX,
  TARGET_SOLD_MIN,
  TARGET_STARTER_DEALERS,
} from "./constants";
import {
  BLOCKED_SAMPLE_NAMES,
  dealerDescription,
  listingTitle,
  listingTown,
  privateDescription,
  reviewComment,
} from "./copy";
import { listingImageUrls, photoKindFor } from "./photos";
import {
  expiresOffsetDays,
  expiredCreatedDaysAgo,
  LIVE_MAX_AGE_DAYS,
  liveCreatedDaysAgo,
  soldCreatedDaysAgo,
  soldDaysAgoFor,
  viewCountFor,
} from "./timeline";
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
  soldDaysAgo?: number;
  expiresOffsetDays: number | null;
  viewCount: number;
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
  createdDaysAgo: number;
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
  { key: "peter-cain", authUserId: "00000000-0000-0000-0000-000000000209", email: "peter.cain@example.im", name: "Peter Cain" },
  { key: "lucy-faragher", authUserId: "00000000-0000-0000-0000-000000000210", email: "lucy.faragher@example.im", name: "Lucy Faragher" },
  { key: "james-gelling", authUserId: "00000000-0000-0000-0000-000000000211", email: "james.gelling@example.im", name: "James Gelling" },
  { key: "rachel-teare", authUserId: "00000000-0000-0000-0000-000000000212", email: "rachel.teare@example.im", name: "Rachel Teare" },
  { key: "ben-kissack", authUserId: "00000000-0000-0000-0000-000000000213", email: "ben.kissack@example.im", name: "Ben Kissack" },
  { key: "hannah-crellin", authUserId: "00000000-0000-0000-0000-000000000214", email: "hannah.crellin@example.im", name: "Hannah Crellin" },
  { key: "oliver-skillicorn", authUserId: "00000000-0000-0000-0000-000000000215", email: "oliver.skillicorn@example.im", name: "Oliver Skillicorn" },
  { key: "nia-callister", authUserId: "00000000-0000-0000-0000-000000000216", email: "nia.callister@example.im", name: "Nia Callister" },
  { key: "sam-quirk", authUserId: "00000000-0000-0000-0000-000000000217", email: "sam.quirk@example.im", name: "Sam Quirk" },
  { key: "kate-bridson", authUserId: "00000000-0000-0000-0000-000000000218", email: "kate.bridson@example.im", name: "Kate Bridson" },
  { key: "liam-cannell", authUserId: "00000000-0000-0000-0000-000000000219", email: "liam.cannell@example.im", name: "Liam Cannell" },
  { key: "ellen-kneale", authUserId: "00000000-0000-0000-0000-000000000220", email: "ellen.kneale@example.im", name: "Ellen Kneale" },
  { key: "ryan-cowin", authUserId: "00000000-0000-0000-0000-000000000221", email: "ryan.cowin@example.im", name: "Ryan Cowin" },
  { key: "maya-lewthwaite", authUserId: "00000000-0000-0000-0000-000000000222", email: "maya.lewthwaite@example.im", name: "Maya Lewthwaite" },
];

function slugKey(slug: string) {
  return slug.replace(/[^a-z0-9]+/g, "-");
}

function pad(value: number) {
  return String(value).padStart(3, "0");
}

const CATEGORY_WEIGHTS = [
  ...Array.from({ length: 70 }, () => "car" as const),
  ...Array.from({ length: 15 }, () => "van" as const),
  ...Array.from({ length: 10 }, () => "motorbike" as const),
  ...Array.from({ length: 5 }, () => "motorhome" as const),
] as const;

function templatesFor(category: VehicleCategory) {
  return VEHICLE_TEMPLATES.filter((template) => template.category === category);
}

function templateAt(index: number) {
  const category = CATEGORY_WEIGHTS[index % CATEGORY_WEIGHTS.length];
  const pool = templatesFor(category);
  return pool[Math.floor(index / CATEGORY_WEIGHTS.length) % pool.length] ?? pool[0];
}

function buildAttributes(
  template: (typeof VEHICLE_TEMPLATES)[number],
  index: number,
  regionSlug: string,
): Record<string, string> {
  const year = String(2012 + (index % 13));
  const age = Math.max(1, 2026 - Number(year));
  const mileage = String(12000 * age + ((index * 1700) % 18000));
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

function createdDaysAgoFor(status: ListingStatus, index: number) {
  if (status === "LIVE" || status === "PENDING" || status === "DRAFT") {
    return liveCreatedDaysAgo(index);
  }
  if (status === "SOLD") return soldCreatedDaysAgo(index);
  if (status === "EXPIRED") return expiredCreatedDaysAgo(index);
  return 20 + (index % 40);
}

function imageCountFor(status: ListingStatus, isDealer: boolean, featured: boolean) {
  if (status === "EXPIRED") return 2;
  if (isDealer || featured) return 4 + (featured ? 2 : 0);
  return 3;
}

function buildListing(input: {
  key: string;
  index: number;
  status: ListingStatus;
  sellerKey: string;
  dealerKey?: string;
  dealerName?: string;
  featured?: boolean;
}): PlannedListing {
  const template = templateAt(input.index);
  const regionSlug =
    input.index % 21 === 0 ? "uk" : IOM_REGION_SLUGS[input.index % IOM_REGION_SLUGS.length];
  const attributes = buildAttributes(template, input.index, regionSlug);
  const year = attributes.year;
  const featured = input.featured ?? input.index % 17 === 0;
  const daysAgo = createdDaysAgoFor(input.status, input.index);
  const town = listingTown(input.index);
  const kind = photoKindFor({ category: template.category, bodyType: template.bodyType });
  const imageCount = imageCountFor(input.status, Boolean(input.dealerKey), featured);
  const description = input.dealerName
    ? dealerDescription({
        make: template.make,
        model: template.model,
        year,
        mileage: attributes.mileage,
        town,
        dealerName: input.dealerName,
        index: input.index,
      })
    : privateDescription({
        make: template.make,
        model: template.model,
        year,
        mileage: attributes.mileage,
        town,
        index: input.index,
      });
  return {
    key: input.key,
    title: listingTitle({
      year,
      make: template.make,
      model: template.model,
      index: input.index,
    }),
    description,
    category: template.category,
    regionSlug,
    pricePence: Math.round(template.pricePounds * 100),
    status: input.status,
    featured,
    daysAgo,
    soldDaysAgo:
      input.status === "SOLD" ? soldDaysAgoFor(daysAgo, input.index) : undefined,
    expiresOffsetDays: expiresOffsetDays({ status: input.status, createdDaysAgo: daysAgo }),
    viewCount: viewCountFor(daysAgo, input.status),
    dealerKey: input.dealerKey,
    sellerKey: input.sellerKey,
    attributes,
    imageUrls: listingImageUrls({ kind, index: input.index, count: imageCount }),
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
          dealerName: dealer.name,
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

  const draftOwner = sellers.find((seller) => seller.preservedUserId) ?? sellers[0];
  listings.push(
    buildListing({
      key: "draft-001",
      index,
      status: "DRAFT",
      sellerKey: draftOwner.key,
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
    comment: reviewComment({
      dealerName: dealer.name,
      rating: 4 + (index % 2),
      index,
    }),
    status: "APPROVED" as const,
    createdDaysAgo: 40 + ((index * 13) % 280),
  }));
  reviews.push({
    dealerKey: dealers[0].key,
    reviewerKey: reviewerPool[1 % reviewerPool.length].key,
    rating: 3,
    comment: reviewComment({
      dealerName: dealers[0].name,
      rating: 3,
      index: 21,
    }),
    status: "PENDING",
    createdDaysAgo: 12,
  });
  reviews.push({
    dealerKey: dealers[1]?.key ?? dealers[0].key,
    reviewerKey: reviewerPool[2 % reviewerPool.length].key,
    rating: 1,
    comment: reviewComment({
      dealerName: dealers[1]?.name ?? dealers[0].name,
      rating: 1,
      index: 22,
    }),
    status: "HIDDEN",
    createdDaysAgo: 90,
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
    version: DATASET_VERSION,
    dealers,
    sellers,
    listings,
    reviews,
  };
  assertMarketplacePlan(plan, input.now);
  return plan;
}

export function assertMarketplacePlan(plan: MarketplacePlan, now: Date) {
  const liveListings = plan.listings.filter((listing) => listing.status === "LIVE");
  const live = liveListings.length;
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
  const fictionalSellers = plan.sellers.filter((seller) => !seller.preservedUserId);
  if (fictionalSellers.length < TARGET_PRIVATE_SELLERS) {
    throw new Error(`Expected at least ${TARGET_PRIVATE_SELLERS} private sellers.`);
  }
  const sellerKeys = new Set([
    ...plan.sellers.map((seller) => seller.key),
    ...plan.dealers.map((dealer) => dealer.key),
  ]);
  for (const listing of plan.listings) {
    if (!sellerKeys.has(listing.sellerKey)) {
      throw new Error(`Listing ${listing.key} references missing seller ${listing.sellerKey}.`);
    }
  }

  const descriptions = new Set(plan.listings.map((listing) => listing.description));
  if (descriptions.size !== plan.listings.length) {
    throw new Error("Listing descriptions must be unique.");
  }
  const banned = new Set(BLOCKED_SAMPLE_NAMES.map((name) => name.toLowerCase()));
  if (
    plan.dealers.some(
      (dealer) => !dealer.preservedUserId && banned.has(dealer.name.toLowerCase()),
    )
  ) {
    throw new Error("Plan must not include Morris motors or Ocean Motor Village.");
  }
  if (liveListings.some((listing) => listing.daysAgo > LIVE_MAX_AGE_DAYS)) {
    throw new Error("LIVE listings must stay inside the 60-day window.");
  }
  const historic = plan.listings.filter(
    (listing) => listing.status === "SOLD" || listing.status === "EXPIRED",
  );
  const oldest = Math.max(...historic.map((listing) => listing.daysAgo));
  if (oldest < 300) {
    throw new Error("Sold/expired history must span at least 300 days.");
  }
  for (const listing of plan.listings) {
    if (
      (listing.status === "LIVE" ||
        listing.status === "PENDING" ||
        listing.status === "SOLD") &&
      listing.imageUrls.length < 2
    ) {
      throw new Error(`${listing.status} listings need at least 2 photos.`);
    }
  }
  const share = (category: VehicleCategory) =>
    plan.listings.filter((listing) => listing.category === category).length /
    plan.listings.length;
  if (share("car") < 0.65 || share("car") > 0.75) {
    throw new Error(`Car share ${share("car")} is outside 0.65-0.75.`);
  }
  if (share("van") < 0.12 || share("van") > 0.18) {
    throw new Error(`Van share ${share("van")} is outside 0.12-0.18.`);
  }
  if (share("motorbike") < 0.08 || share("motorbike") > 0.12) {
    throw new Error(`Motorbike share ${share("motorbike")} is outside 0.08-0.12.`);
  }
  if (share("motorhome") < 0.03 || share("motorhome") > 0.07) {
    throw new Error(`Motorhome share ${share("motorhome")} is outside 0.03-0.07.`);
  }

  const preservedBlocked = plan.dealers.some(
    (dealer) => dealer.preservedUserId && banned.has(dealer.name.toLowerCase()),
  );
  if (!preservedBlocked) {
    const blockedCopy = [...banned];
    for (const listing of plan.listings) {
      const haystack = listing.description.toLowerCase();
      if (blockedCopy.some((name) => haystack.includes(name))) {
        throw new Error("Listing copy must not mention Morris or Ocean identities.");
      }
    }
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

import * as fs from "fs";
import * as path from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

// Load .env then .env.local so the seed always targets the same DB as the dev server.
// .env.local values take priority, matching Next.js conventions.
function loadEnv(file: string, override = false) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^"(.*)"$/, "$1");
    if (key && (override || !process.env[key])) process.env[key] = val;
  }
}
loadEnv(path.resolve(process.cwd(), ".env"));
loadEnv(path.resolve(process.cwd(), ".env.local"), true);

const raw =
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.DATABASE_URL ??
  "";

// Strip sslmode param – pg v8+ treats sslmode=require as verify-full
// which clashes with our explicit ssl config below.
function cleanUrl(s: string): string {
  try {
    const u = new URL(s.trim());
    u.searchParams.delete("sslmode");
    return u.toString();
  } catch {
    return s.trim();
  }
}

const pool = new pg.Pool({
  connectionString: cleanUrl(raw),
  ssl: { rejectUnauthorized: false },
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/**
 * Vehicle-only seed for itrader.im.
 * Clears existing placeholder data, then creates regions, vehicle categories (Car, Van, Motorbike),
 * attribute definitions, users, dealers, and vehicle-only LIVE listings.
 */
async function main() {
  console.log("Seeding itrader.im database (vehicle-only)...\n");

  // ---------------------------------------------------------------------------
  // Clear existing placeholder data (listings and related)
  // ---------------------------------------------------------------------------
  await prisma.payment.deleteMany({});
  await prisma.listingImage.deleteMany({});
  await prisma.listingAttributeValue.deleteMany({});
  await prisma.report.deleteMany({});
  await prisma.listing.deleteMany({});
  await prisma.subscription.deleteMany({});
  await prisma.dealerProfile.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.attributeDefinition.deleteMany({});
  await prisma.category.deleteMany({});
  console.log("  Cleared existing listings, attribute definitions, categories, users, and dealers");

  // ---------------------------------------------------------------------------
  // Regions (Isle of Man towns)
  // ---------------------------------------------------------------------------
  const regionData = [
    { name: "Entire Isle of Man", slug: "isle-of-man" },
    { name: "United Kingdom", slug: "uk" },
    { name: "Douglas", slug: "douglas" },
    { name: "Ramsey", slug: "ramsey" },
    { name: "Peel", slug: "peel" },
    { name: "Castletown", slug: "castletown" },
    { name: "Port Erin", slug: "port-erin" },
    { name: "Onchan", slug: "onchan" },
    { name: "Laxey", slug: "laxey" },
    { name: "Port St Mary", slug: "port-st-mary" },
    { name: "Ballasalla", slug: "ballasalla" },
    { name: "Kirk Michael", slug: "kirk-michael" },
  ];

  const regions: Record<string, { id: string }> = {};
  for (const r of regionData) {
    const region = await prisma.region.upsert({
      where: { slug: r.slug },
      update: {},
      create: { name: r.name, slug: r.slug, active: true },
    });
    regions[r.slug] = region;
  }
  console.log(`  Created ${regionData.length} regions`);

  // ---------------------------------------------------------------------------
  // Vehicle-only categories: Car, Van, Motorbike
  // ---------------------------------------------------------------------------
  const car = await prisma.category.create({
    data: { name: "Car", slug: "car", sortOrder: 1 },
  });
  const van = await prisma.category.create({
    data: { name: "Van", slug: "van", sortOrder: 2 },
  });
  const motorbike = await prisma.category.create({
    data: { name: "Motorbike", slug: "motorbike", sortOrder: 3 },
  });
  console.log("  Created 3 vehicle categories (Car, Van, Motorbike)");

  // ---------------------------------------------------------------------------
  // Attribute definitions (make, model, year, mileage, fuel-type, transmission)
  // Shared across Car, Van, Motorbike for consistent search/filtering.
  // ---------------------------------------------------------------------------
  const vehicleAttrDefs = [
    { name: "Make", slug: "make", dataType: "text", required: true, sortOrder: 1 },
    { name: "Model", slug: "model", dataType: "text", required: true, sortOrder: 2 },
    { name: "Year", slug: "year", dataType: "number", required: true, sortOrder: 3 },
    { name: "Mileage", slug: "mileage", dataType: "number", required: false, sortOrder: 4 },
    {
      name: "Fuel Type",
      slug: "fuel-type",
      dataType: "select",
      required: false,
      sortOrder: 5,
      options: JSON.stringify(["Petrol", "Diesel", "Electric", "Hybrid", "Plug-in Hybrid"]),
    },
    {
      name: "Transmission",
      slug: "transmission",
      dataType: "select",
      required: false,
      sortOrder: 6,
      options: JSON.stringify(["Manual", "Automatic"]),
    },
    {
      name: "Body Type",
      slug: "body-type",
      dataType: "select",
      required: false,
      sortOrder: 7,
      options: JSON.stringify(["Hatchback", "Saloon", "SUV", "Estate", "Coupe", "Convertible", "MPV", "Pickup"]),
    },
    {
      name: "Colour",
      slug: "colour",
      dataType: "select",
      required: false,
      sortOrder: 8,
      options: JSON.stringify(["Black", "White", "Silver", "Grey", "Blue", "Red", "Green", "Yellow", "Orange", "Brown", "Gold", "Bronze", "Other"]),
    },
    { name: "Doors", slug: "doors", dataType: "number", required: false, sortOrder: 9 },
    { name: "Seats", slug: "seats", dataType: "number", required: false, sortOrder: 10 },
    { name: "Engine Size", slug: "engine-size", dataType: "number", required: false, sortOrder: 11 },
    { name: "Engine Power", slug: "engine-power", dataType: "number", required: false, sortOrder: 12 },
    { name: "Battery Range", slug: "battery-range", dataType: "number", required: false, sortOrder: 13 },
    { name: "Charging Time", slug: "charging-time", dataType: "number", required: false, sortOrder: 14 },
    { name: "Acceleration", slug: "acceleration", dataType: "number", required: false, sortOrder: 15 },
    { name: "Fuel Consumption", slug: "fuel-consumption", dataType: "number", required: false, sortOrder: 16 },
    { name: "CO2 Emissions", slug: "co2-emissions", dataType: "number", required: false, sortOrder: 17 },
    { name: "Tax Per Year", slug: "tax-per-year", dataType: "number", required: false, sortOrder: 18 },
    { name: "Insurance Group", slug: "insurance-group", dataType: "number", required: false, sortOrder: 19 },
    {
      name: "Location",
      slug: "location",
      dataType: "select",
      required: false,
      sortOrder: 20,
      options: JSON.stringify(["Isle of Man", "UK"]),
    },
    {
      name: "Drive Type",
      slug: "drive-type",
      dataType: "select",
      required: false,
      sortOrder: 21,
      options: JSON.stringify(["FWD", "RWD", "4WD", "AWD"]),
    },
    {
      name: "Previously Written Off",
      slug: "previously-written-off",
      dataType: "boolean",
      required: false,
      sortOrder: 22,
    },
    { name: "Boot Space", slug: "boot-space", dataType: "number", required: false, sortOrder: 23 },
  ];

  const motorbikeAttrDefs = vehicleAttrDefs.filter(
    (a) => !["body-type", "doors", "boot-space"].includes(a.slug),
  );

  const carAttrs: Record<string, { id: string }> = {};
  for (const attr of vehicleAttrDefs) {
    const created = await prisma.attributeDefinition.create({
      data: {
        categoryId: car.id,
        name: attr.name,
        slug: attr.slug,
        dataType: attr.dataType,
        required: attr.required,
        sortOrder: attr.sortOrder,
        options: (attr as { options?: string }).options ?? null,
      },
    });
    carAttrs[attr.slug] = created;
  }

  const vanAttrs: Record<string, { id: string }> = {};
  for (const attr of vehicleAttrDefs) {
    const created = await prisma.attributeDefinition.create({
      data: {
        categoryId: van.id,
        name: attr.name,
        slug: attr.slug,
        dataType: attr.dataType,
        required: attr.required,
        sortOrder: attr.sortOrder,
        options: (attr as { options?: string }).options ?? null,
      },
    });
    vanAttrs[attr.slug] = created;
  }

  const motorbikeAttrs: Record<string, { id: string }> = {};
  for (const attr of motorbikeAttrDefs) {
    const created = await prisma.attributeDefinition.create({
      data: {
        categoryId: motorbike.id,
        name: attr.name,
        slug: attr.slug,
        dataType: attr.dataType,
        required: attr.required,
        sortOrder: attr.sortOrder,
        options: (attr as { options?: string }).options ?? null,
      },
    });
    motorbikeAttrs[attr.slug] = created;
  }
  console.log(`  Created ${vehicleAttrDefs.length} attribute definitions for Car/Van, ${motorbikeAttrDefs.length} for Motorbike`);

  // ---------------------------------------------------------------------------
  // Demo users (authUserId = placeholder UUIDs; not real Supabase Auth users)
  // ---------------------------------------------------------------------------
  const demoUsers = [
    { authUserId: "00000000-0000-0000-0000-000000000001", email: "john.quayle@example.im", name: "John Quayle", role: "USER" as const },
    { authUserId: "00000000-0000-0000-0000-000000000002", email: "sarah.craine@example.im", name: "Sarah Craine", role: "USER" as const },
    { authUserId: "00000000-0000-0000-0000-000000000003", email: "mark.kelly@example.im", name: "Mark Kelly", role: "USER" as const },
    { authUserId: "00000000-0000-0000-0000-000000000004", email: "emma.corlett@example.im", name: "Emma Corlett", role: "USER" as const },
    { authUserId: "00000000-0000-0000-0000-000000000005", email: "info@manxmotors.im", name: "Manx Motors Ltd", role: "DEALER" as const },
    { authUserId: "00000000-0000-0000-0000-000000000006", email: "info@ramseymotors.im", name: "Ramsey Motor Company", role: "DEALER" as const },
    { authUserId: "00000000-0000-0000-0000-000000000007", email: "sales@douglasauto.im", name: "Douglas Auto Exchange", role: "DEALER" as const },
    { authUserId: "00000000-0000-0000-0000-000000000008", email: "david.shimmin@example.im", name: "David Shimmin", role: "USER" as const },
    { authUserId: "00000000-0000-0000-0000-000000000009", email: "fiona.clague@example.im", name: "Fiona Clague", role: "USER" as const },
    { authUserId: "00000000-0000-0000-0000-00000000000a", email: "admin@itrader.im", name: "itrader.im Admin", role: "ADMIN" as const },
  ];

  const users: Record<string, { id: string }> = {};
  for (const u of demoUsers) {
    const user = await prisma.user.upsert({
      where: { authUserId: u.authUserId },
      update: {},
      create: {
        authUserId: u.authUserId,
        email: u.email,
        name: u.name,
        role: u.role,
        regionId: regions["isle-of-man"].id,
      },
    });
    users[u.authUserId] = user;
  }
  const dealer001 = "00000000-0000-0000-0000-000000000005";
  const dealer002 = "00000000-0000-0000-0000-000000000006";
  const dealer003 = "00000000-0000-0000-0000-000000000007";
  const user001 = "00000000-0000-0000-0000-000000000001";
  const user002 = "00000000-0000-0000-0000-000000000002";
  const user003 = "00000000-0000-0000-0000-000000000003";
  const user004 = "00000000-0000-0000-0000-000000000004";
  const user005 = "00000000-0000-0000-0000-000000000008";
  console.log(`  Created ${demoUsers.length} users`);

  // ---------------------------------------------------------------------------
  // Dealer profiles
  // ---------------------------------------------------------------------------
  const manxMotors = await prisma.dealerProfile.upsert({
    where: { slug: "manx-motors" },
    update: {},
    create: {
      userId: users[dealer001].id,
      name: "Manx Motors Ltd",
      slug: "manx-motors",
      bio: "The Isle of Man's premier used car dealership. We've been serving the island for over 15 years with quality pre-owned vehicles, full service history checks, and honest pricing. Visit our showroom on Peel Road, Douglas.",
      website: "https://manxmotors.example.im",
      phone: "01624 612345",
      verified: true,
    },
  });

  const ramseyMotors = await prisma.dealerProfile.upsert({
    where: { slug: "ramsey-motors" },
    update: {},
    create: {
      userId: users[dealer002].id,
      name: "Ramsey Motor Company",
      slug: "ramsey-motors",
      bio: "Family-run pre-owned car dealership based in Ramsey, serving the north of the island since 2001. We specialise in quality used cars and light vans, with part-exchange welcome and flexible finance options available.",
      website: "https://ramseymotors.example.im",
      phone: "01624 813456",
      verified: true,
    },
  });

  const douglasAuto = await prisma.dealerProfile.upsert({
    where: { slug: "douglas-auto" },
    update: {},
    create: {
      userId: users[dealer003].id,
      name: "Douglas Auto Exchange",
      slug: "douglas-auto",
      bio: "Douglas-based used vehicle specialist offering cars, vans, and 4x4s across all budgets. HPI-checked stock, same-day test drives, and competitive part-exchange valuations. Find us on Peel Road.",
      website: "https://douglasauto.example.im",
      phone: "01624 671234",
      verified: true,
    },
  });

  console.log("  Created 3 dealer profiles");

  // Dealer subscriptions (active)
  for (const dealer of [manxMotors, ramseyMotors, douglasAuto]) {
    await prisma.subscription.upsert({
      where: { stripeSubscriptionId: `demo_sub_${dealer.slug}` },
      update: {},
      create: {
        dealerId: dealer.id,
        stripeSubscriptionId: `demo_sub_${dealer.slug}`,
        stripePriceId: "price_demo_dealer_monthly",
        status: "ACTIVE",
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  }
  console.log("  Created 3 dealer subscriptions");

  // ---------------------------------------------------------------------------
  // Placeholder images (Unsplash – vehicles only)
  // ---------------------------------------------------------------------------
  const IMG = {
    // Cars
    bmw3: "https://images.unsplash.com/photo-1555215695-3004980ad54e?w=800&h=600&fit=crop",
    audi: "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=800&h=600&fit=crop",
    vw: "https://images.unsplash.com/photo-1583267746897-2cf415887172?w=800&h=600&fit=crop",
    mini: "https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=800&h=600&fit=crop",
    landrover: "https://images.unsplash.com/photo-1606016159991-dfe4f2746ad5?w=800&h=600&fit=crop",
    tesla: "https://images.unsplash.com/photo-1560958089-b8a1929cea89?w=800&h=600&fit=crop",
    ford: "https://images.unsplash.com/photo-1551830820-330a71b99659?w=800&h=600&fit=crop",
    merc: "https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?w=800&h=600&fit=crop",
    porsche: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=800&h=600&fit=crop",
    // Vans
    van1: "https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=800&h=600&fit=crop",
    van2: "https://images.unsplash.com/photo-1625047509168-a7026f36de04?w=800&h=600&fit=crop",
    van3: "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?w=800&h=600&fit=crop",
    // Motorbikes
    bike1: "https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=800&h=600&fit=crop",
    bike2: "https://images.unsplash.com/photo-1609630875171-b1321377ee65?w=800&h=600&fit=crop",
    bike3: "https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?w=800&h=600&fit=crop",
  };

  // ---------------------------------------------------------------------------
  // Listings
  // ---------------------------------------------------------------------------

  const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // Helper to create a listing + image + optional attributes
  async function createListing(data: {
    userId: string;
    dealerId?: string;
    categoryId: string;
    regionSlug: string;
    title: string;
    description: string;
    price: number; // in pounds
    featured?: boolean;
    imageUrl: string;
    attributes?: Array<{ attrId: string; value: string }>;
    daysAgo?: number;
  }) {
    const createdAt = new Date(Date.now() - (data.daysAgo ?? 0) * 24 * 60 * 60 * 1000);
    const listing = await prisma.listing.create({
      data: {
        userId: data.userId,
        dealerId: data.dealerId ?? null,
        categoryId: data.categoryId,
        regionId: regions[data.regionSlug].id,
        title: data.title,
        description: data.description,
        price: Math.round(data.price * 100), // convert pounds to pence
        status: "LIVE",
        featured: data.featured ?? false,
        expiresAt: thirtyDaysFromNow,
        createdAt,
        attributeValues: data.attributes
          ? {
              create: data.attributes.map((a) => ({
                attributeDefinitionId: a.attrId,
                value: a.value,
              })),
            }
          : undefined,
      },
    });

    await prisma.listingImage.create({
      data: {
        listingId: listing.id,
        url: data.imageUrl,
        publicId: `demo/${listing.id}`,
        order: 0,
      },
    });

    // Create a corresponding payment record
    await prisma.payment.create({
      data: {
        listingId: listing.id,
        stripePaymentId: `demo_pi_${listing.id}`,
        amount: 499,
        currency: "gbp",
        status: "SUCCEEDED",
        idempotencyKey: `demo_idem_${listing.id}`,
      },
    });

    return listing;
  }

  // --- CARS (10 listings) ---

  await createListing({
    userId: users[dealer001].id,
    dealerId: manxMotors.id,
    categoryId: car.id,
    regionSlug: "douglas",
    title: "2021 BMW 320d M Sport – Immaculate Condition",
    description: "One owner from new, full BMW service history. This stunning 320d M Sport comes in Mineral Grey with black Dakota leather interior. Features include M Sport suspension, professional navigation, Harman Kardon sound system, and rear parking camera. MOT until March 2027. Excellent condition throughout – must be seen.",
    price: 24995,
    featured: true,
    imageUrl: IMG.bmw3,
    attributes: [
      { attrId: carAttrs["make"].id, value: "BMW" },
      { attrId: carAttrs["model"].id, value: "320d M Sport" },
      { attrId: carAttrs["year"].id, value: "2021" },
      { attrId: carAttrs["mileage"].id, value: "34200" },
      { attrId: carAttrs["fuel-type"].id, value: "Diesel" },
      { attrId: carAttrs["transmission"].id, value: "Automatic" },
    ],
    daysAgo: 2,
  });

  await createListing({
    userId: users[dealer001].id,
    dealerId: manxMotors.id,
    categoryId: car.id,
    regionSlug: "douglas",
    title: "2020 Audi A4 35 TFSI S Line – Low Miles",
    description: "Beautiful Audi A4 S Line in Navarra Blue. Features virtual cockpit, LED headlights, 3-zone climate control, and Audi smartphone interface. Only 28,000 miles. Two keys, full Audi service history. Finance available.",
    price: 22450,
    featured: true,
    imageUrl: IMG.audi,
    attributes: [
      { attrId: carAttrs["make"].id, value: "Audi" },
      { attrId: carAttrs["model"].id, value: "A4 35 TFSI S Line" },
      { attrId: carAttrs["year"].id, value: "2020" },
      { attrId: carAttrs["mileage"].id, value: "28100" },
      { attrId: carAttrs["fuel-type"].id, value: "Petrol" },
      { attrId: carAttrs["transmission"].id, value: "Automatic" },
    ],
    daysAgo: 3,
  });

  await createListing({
    userId: users[user001].id,
    categoryId: car.id,
    regionSlug: "ramsey",
    title: "2018 VW Golf 1.5 TSI Match – Great Runner",
    description: "Reliable family hatchback in very good condition. Glacier White, cloth seats, touchscreen infotainment with Apple CarPlay. 4 new tyres fitted recently. Selling as upgrading to something larger. Any inspection welcome.",
    price: 12750,
    imageUrl: IMG.vw,
    attributes: [
      { attrId: carAttrs["make"].id, value: "Volkswagen" },
      { attrId: carAttrs["model"].id, value: "Golf 1.5 TSI Match" },
      { attrId: carAttrs["year"].id, value: "2018" },
      { attrId: carAttrs["mileage"].id, value: "52300" },
      { attrId: carAttrs["fuel-type"].id, value: "Petrol" },
      { attrId: carAttrs["transmission"].id, value: "Manual" },
    ],
    daysAgo: 5,
  });

  await createListing({
    userId: users[dealer001].id,
    dealerId: manxMotors.id,
    categoryId: car.id,
    regionSlug: "douglas",
    title: "2022 Tesla Model 3 Long Range – Island Perfect",
    description: "Stunning Pearl White Tesla Model 3 Long Range AWD. Over 300 miles range, autopilot, premium interior with heated seats front and rear. Perfect for island driving – charge at home overnight. Low road tax. Full Tesla warranty remaining.",
    price: 33995,
    featured: true,
    imageUrl: IMG.tesla,
    attributes: [
      { attrId: carAttrs["make"].id, value: "Tesla" },
      { attrId: carAttrs["model"].id, value: "Model 3 Long Range" },
      { attrId: carAttrs["year"].id, value: "2022" },
      { attrId: carAttrs["mileage"].id, value: "18500" },
      { attrId: carAttrs["fuel-type"].id, value: "Electric" },
      { attrId: carAttrs["transmission"].id, value: "Automatic" },
    ],
    daysAgo: 1,
  });

  await createListing({
    userId: users[user002].id,
    categoryId: car.id,
    regionSlug: "peel",
    title: "2017 MINI Cooper S 3-Door – Fun Island Car",
    description: "Chili Red MINI Cooper S with John Cooper Works bodykit. Heated seats, satellite navigation, Harman Kardon speakers. Fast and fun but also economical. Genuine reason for sale – emigrating. Priced to sell quickly.",
    price: 11500,
    imageUrl: IMG.mini,
    attributes: [
      { attrId: carAttrs["make"].id, value: "MINI" },
      { attrId: carAttrs["model"].id, value: "Cooper S" },
      { attrId: carAttrs["year"].id, value: "2017" },
      { attrId: carAttrs["mileage"].id, value: "45600" },
      { attrId: carAttrs["fuel-type"].id, value: "Petrol" },
      { attrId: carAttrs["transmission"].id, value: "Manual" },
    ],
    daysAgo: 7,
  });

  await createListing({
    userId: users[dealer001].id,
    dealerId: manxMotors.id,
    categoryId: car.id,
    regionSlug: "douglas",
    title: "2019 Land Rover Discovery Sport HSE – 7 Seater",
    description: "Versatile 7-seat SUV in Corris Grey. HSE spec includes leather, panoramic roof, touchscreen pro nav, 360-degree parking aid. Ideal for island families. Full Land Rover service history, cam belt done at 60k.",
    price: 28750,
    imageUrl: IMG.landrover,
    attributes: [
      { attrId: carAttrs["make"].id, value: "Land Rover" },
      { attrId: carAttrs["model"].id, value: "Discovery Sport HSE" },
      { attrId: carAttrs["year"].id, value: "2019" },
      { attrId: carAttrs["mileage"].id, value: "61200" },
      { attrId: carAttrs["fuel-type"].id, value: "Diesel" },
      { attrId: carAttrs["transmission"].id, value: "Automatic" },
    ],
    daysAgo: 4,
  });

  await createListing({
    userId: users[user003].id,
    categoryId: car.id,
    regionSlug: "castletown",
    title: "2015 Ford Fiesta 1.0 EcoBoost Zetec – First Car Special",
    description: "Perfect first car or runabout. Well maintained, MOT until October. Metallic blue, Bluetooth, air con, electric windows. Cheap to run and insure. Slight dent on rear quarter – reflected in price.",
    price: 5995,
    imageUrl: IMG.ford,
    attributes: [
      { attrId: carAttrs["make"].id, value: "Ford" },
      { attrId: carAttrs["model"].id, value: "Fiesta 1.0 EcoBoost Zetec" },
      { attrId: carAttrs["year"].id, value: "2015" },
      { attrId: carAttrs["mileage"].id, value: "78400" },
      { attrId: carAttrs["fuel-type"].id, value: "Petrol" },
      { attrId: carAttrs["transmission"].id, value: "Manual" },
    ],
    daysAgo: 10,
  });

  await createListing({
    userId: users[dealer001].id,
    dealerId: manxMotors.id,
    categoryId: car.id,
    regionSlug: "douglas",
    title: "2023 Mercedes-Benz A-Class A200 AMG Line – Nearly New",
    description: "Delivery miles only on this stunning Cosmos Black A-Class. AMG Line styling, MBUX infotainment with touchscreen, LED high performance headlights, ambient lighting, reversing camera. Manufacturer warranty until 2026.",
    price: 29995,
    imageUrl: IMG.merc,
    attributes: [
      { attrId: carAttrs["make"].id, value: "Mercedes-Benz" },
      { attrId: carAttrs["model"].id, value: "A200 AMG Line" },
      { attrId: carAttrs["year"].id, value: "2023" },
      { attrId: carAttrs["mileage"].id, value: "3200" },
      { attrId: carAttrs["fuel-type"].id, value: "Petrol" },
      { attrId: carAttrs["transmission"].id, value: "Automatic" },
    ],
    daysAgo: 1,
  });

  await createListing({
    userId: users[user005].id,
    categoryId: car.id,
    regionSlug: "onchan",
    title: "2016 Porsche Cayman 718 – Weekend Toy",
    description: "Guards Red 718 Cayman with extended leather in Black. Sport Chrono package, PASM sport suspension, BOSE surround sound. Garaged, only used on dry days. HPI clear. A true driver's car for someone who appreciates the finer things.",
    price: 38500,
    featured: true,
    imageUrl: IMG.porsche,
    attributes: [
      { attrId: carAttrs["make"].id, value: "Porsche" },
      { attrId: carAttrs["model"].id, value: "718 Cayman" },
      { attrId: carAttrs["year"].id, value: "2016" },
      { attrId: carAttrs["mileage"].id, value: "22100" },
      { attrId: carAttrs["fuel-type"].id, value: "Petrol" },
      { attrId: carAttrs["transmission"].id, value: "Manual" },
    ],
    daysAgo: 3,
  });

  // --- VANS (3 listings) ---

  await createListing({
    userId: users[dealer001].id,
    dealerId: manxMotors.id,
    categoryId: van.id,
    regionSlug: "douglas",
    title: "2020 Ford Transit Custom 2.0 TDCi 290 L2 – Low Miles",
    description: "Ideal for trades or delivery. 290 L2 in Frozen White, 125,000 miles with full service history. Ply-lined, bulkhead, side loading door. MOT until next year. Ready for work.",
    price: 18500,
    featured: true,
    imageUrl: IMG.van1,
    attributes: [
      { attrId: vanAttrs["make"].id, value: "Ford" },
      { attrId: vanAttrs["model"].id, value: "Transit Custom 290 L2" },
      { attrId: vanAttrs["year"].id, value: "2020" },
      { attrId: vanAttrs["mileage"].id, value: "125000" },
      { attrId: vanAttrs["fuel-type"].id, value: "Diesel" },
      { attrId: vanAttrs["transmission"].id, value: "Manual" },
    ],
    daysAgo: 4,
  });

  await createListing({
    userId: users[user001].id,
    categoryId: van.id,
    regionSlug: "ramsey",
    title: "2018 Mercedes-Benz Vito Tourer 111 – 8 Seater",
    description: "Spacious people carrier or family van. 111 CDI in obsidian black, leather trim, dual sliding doors. Full service history. Selling due to downsizing.",
    price: 21995,
    imageUrl: IMG.van2,
    attributes: [
      { attrId: vanAttrs["make"].id, value: "Mercedes-Benz" },
      { attrId: vanAttrs["model"].id, value: "Vito Tourer 111" },
      { attrId: vanAttrs["year"].id, value: "2018" },
      { attrId: vanAttrs["mileage"].id, value: "89000" },
      { attrId: vanAttrs["fuel-type"].id, value: "Diesel" },
      { attrId: vanAttrs["transmission"].id, value: "Manual" },
    ],
    daysAgo: 6,
  });

  await createListing({
    userId: users[user003].id,
    categoryId: van.id,
    regionSlug: "peel",
    title: "2016 Volkswagen Caddy Maxi 2.0 TDI – Tidy Runner",
    description: "Compact van, great for island deliveries. Maxi load length, tailgate, tow bar prep. Well maintained, no rust. Genuine reason for sale.",
    price: 11500,
    imageUrl: IMG.van3,
    attributes: [
      { attrId: vanAttrs["make"].id, value: "Volkswagen" },
      { attrId: vanAttrs["model"].id, value: "Caddy Maxi" },
      { attrId: vanAttrs["year"].id, value: "2016" },
      { attrId: vanAttrs["mileage"].id, value: "142000" },
      { attrId: vanAttrs["fuel-type"].id, value: "Diesel" },
      { attrId: vanAttrs["transmission"].id, value: "Manual" },
    ],
    daysAgo: 9,
  });

  // --- MOTORBIKES (3 listings) ---

  await createListing({
    userId: users[user002].id,
    categoryId: motorbike.id,
    regionSlug: "douglas",
    title: "2021 Triumph Street Triple RS – Immaculate",
    description: "765cc triple, quickshifter, Öhlins suspension. Only 4,200 miles. Full Triumph service history. Perfect for TT roads. Two keys, paddock stand included.",
    price: 7995,
    featured: true,
    imageUrl: IMG.bike1,
    attributes: [
      { attrId: motorbikeAttrs["make"].id, value: "Triumph" },
      { attrId: motorbikeAttrs["model"].id, value: "Street Triple RS" },
      { attrId: motorbikeAttrs["year"].id, value: "2021" },
      { attrId: motorbikeAttrs["mileage"].id, value: "4200" },
      { attrId: motorbikeAttrs["fuel-type"].id, value: "Petrol" },
      { attrId: motorbikeAttrs["transmission"].id, value: "Manual" },
    ],
    daysAgo: 2,
  });

  await createListing({
    userId: users[user005].id,
    categoryId: motorbike.id,
    regionSlug: "onchan",
    title: "2019 Honda CB650R – Neo Sports Café",
    description: "Stunning CB650R in Grand Prix Red. 649cc inline-four, slipper clutch, LED lights. Low miles, one owner. HPI clear. Ideal for commuting and weekend blasts.",
    price: 5495,
    imageUrl: IMG.bike2,
    attributes: [
      { attrId: motorbikeAttrs["make"].id, value: "Honda" },
      { attrId: motorbikeAttrs["model"].id, value: "CB650R" },
      { attrId: motorbikeAttrs["year"].id, value: "2019" },
      { attrId: motorbikeAttrs["mileage"].id, value: "11200" },
      { attrId: motorbikeAttrs["fuel-type"].id, value: "Petrol" },
      { attrId: motorbikeAttrs["transmission"].id, value: "Manual" },
    ],
    daysAgo: 5,
  });

  await createListing({
    userId: users[user004].id,
    categoryId: motorbike.id,
    regionSlug: "port-erin",
    title: "2020 Yamaha MT-07 – A2 Compliant",
    description: "Popular MT-07 in Ice Fluo. 689cc twin, great for A2 licence holders. Full exhaust, tail tidy. Service history. Reluctant sale – moving abroad.",
    price: 5750,
    imageUrl: IMG.bike3,
    attributes: [
      { attrId: motorbikeAttrs["make"].id, value: "Yamaha" },
      { attrId: motorbikeAttrs["model"].id, value: "MT-07" },
      { attrId: motorbikeAttrs["year"].id, value: "2020" },
      { attrId: motorbikeAttrs["mileage"].id, value: "9800" },
      { attrId: motorbikeAttrs["fuel-type"].id, value: "Petrol" },
      { attrId: motorbikeAttrs["transmission"].id, value: "Manual" },
    ],
    daysAgo: 7,
  });

  // ---------------------------------------------------------------------------
  // Generated listings (target total: 100-300)
  // ---------------------------------------------------------------------------
  const random = (min: number, max: number) =>
    Math.floor(Math.random() * (max - min + 1)) + min;
  const pick = <T,>(items: readonly T[]): T =>
    items[Math.floor(Math.random() * items.length)];

  const carMakes = ["BMW", "Audi", "Volkswagen", "Ford", "Mercedes-Benz", "Tesla", "MINI", "Kia"] as const;
  const bikeMakes = ["Honda", "Yamaha", "Triumph", "Suzuki", "Kawasaki"] as const;
  const vanMakes = ["Ford", "Volkswagen", "Mercedes-Benz", "Renault"] as const;
  const colours = ["Black", "White", "Silver", "Grey", "Blue", "Red"] as const;
  const fuels = ["Petrol", "Diesel", "Electric", "Hybrid"] as const;
  const transmissions = ["Manual", "Automatic"] as const;
  const iomRegionSlugs = [
    "isle-of-man",
    "douglas",
    "ramsey",
    "peel",
    "castletown",
    "port-erin",
    "onchan",
    "laxey",
    "port-st-mary",
    "ballasalla",
    "kirk-michael",
  ] as const;

  const generatedCount = 120;
  for (let i = 0; i < generatedCount; i++) {
    const categoryRoll = i % 3;
    const categoryId = categoryRoll === 0 ? car.id : categoryRoll === 1 ? van.id : motorbike.id;
    const attrs = categoryRoll === 0 ? carAttrs : categoryRoll === 1 ? vanAttrs : motorbikeAttrs;
    const make =
      categoryRoll === 0 ? pick(carMakes) : categoryRoll === 1 ? pick(vanMakes) : pick(bikeMakes);
    const year = random(2012, 2025);
    const mileage = random(5000, 150000);
    const price = categoryRoll === 2 ? random(2500, 12000) : random(4500, 42000);
    const isElectric = Math.random() < 0.1;
    const fuel = isElectric ? "Electric" : pick(fuels);
    const transmission = pick(transmissions);
    const location = Math.random() < 0.9 ? "Isle of Man" : "UK";
    const regionSlug = location === "UK" ? "uk" : pick(iomRegionSlugs);
    const writtenOff = Math.random() < 0.07 ? "true" : "false";

    const baseAttributes: Array<{ attrId: string; value: string }> = [
      { attrId: attrs["make"].id, value: make },
      { attrId: attrs["model"].id, value: `${make} ${random(1, 9)}${String.fromCharCode(65 + (i % 26))}` },
      { attrId: attrs["year"].id, value: String(year) },
      { attrId: attrs["mileage"].id, value: String(mileage) },
      { attrId: attrs["fuel-type"].id, value: fuel },
      { attrId: attrs["transmission"].id, value: transmission },
      { attrId: attrs["colour"].id, value: pick(colours) },
      { attrId: attrs["tax-per-year"].id, value: String(random(0, 580)) },
      { attrId: attrs["insurance-group"].id, value: String(random(1, 50)) },
      { attrId: attrs["location"].id, value: location },
      { attrId: attrs["previously-written-off"].id, value: writtenOff },
    ];

    if (attrs["engine-size"]) {
      baseAttributes.push({ attrId: attrs["engine-size"].id, value: String(random(10, 65)) });
    }
    if (attrs["engine-power"]) {
      baseAttributes.push({ attrId: attrs["engine-power"].id, value: String(random(65, 420)) });
    }
    if (attrs["battery-range"] && isElectric) {
      baseAttributes.push({ attrId: attrs["battery-range"].id, value: String(random(120, 360)) });
      baseAttributes.push({ attrId: attrs["charging-time"].id, value: String(random(30, 420)) });
    }
    if (attrs["acceleration"]) {
      baseAttributes.push({ attrId: attrs["acceleration"].id, value: String(random(3, 14)) });
    }
    if (attrs["fuel-consumption"]) {
      baseAttributes.push({ attrId: attrs["fuel-consumption"].id, value: String(random(25, 72)) });
    }
    if (attrs["co2-emissions"]) {
      baseAttributes.push({ attrId: attrs["co2-emissions"].id, value: String(random(0, 260)) });
    }
    if (attrs["drive-type"]) {
      baseAttributes.push({ attrId: attrs["drive-type"].id, value: pick(["FWD", "RWD", "4WD", "AWD"] as const) });
    }
    if (attrs["doors"] && categoryRoll !== 2) {
      baseAttributes.push({ attrId: attrs["doors"].id, value: String(pick([2, 3, 4, 5] as const)) });
    }
    if (attrs["seats"]) {
      baseAttributes.push({ attrId: attrs["seats"].id, value: String(categoryRoll === 1 ? pick([2, 3, 5, 6, 8] as const) : pick([2, 4, 5, 7] as const)) });
    }
    if (attrs["boot-space"] && categoryRoll !== 2) {
      baseAttributes.push({ attrId: attrs["boot-space"].id, value: String(random(220, 1400)) });
    }

    await createListing({
      userId: i % 5 === 0 ? users[dealer001].id : users[pick([user001, user002, user003, user004, user005] as const)].id,
      dealerId: i % 5 === 0 ? manxMotors.id : undefined,
      categoryId,
      regionSlug,
      title: `${year} ${make} ${categoryRoll === 2 ? "Motorbike" : categoryRoll === 1 ? "Van" : "Vehicle"} - Excellent Condition`,
      description:
        "Well maintained and in strong mechanical condition. Full history available, recently serviced, and ready to drive away. Contact for details and viewing.",
      price,
      featured: i % 19 === 0,
      imageUrl: categoryRoll === 2 ? pick([IMG.bike1, IMG.bike2, IMG.bike3] as const) : categoryRoll === 1 ? pick([IMG.van1, IMG.van2, IMG.van3] as const) : pick([IMG.bmw3, IMG.audi, IMG.vw, IMG.mini, IMG.landrover, IMG.tesla, IMG.ford, IMG.merc, IMG.porsche] as const),
      attributes: baseAttributes,
      daysAgo: random(0, 28),
    });
  }

  // --- One PENDING listing for admin demo ---
  const pendingListing = await prisma.listing.create({
    data: {
      userId: users[user004].id,
      categoryId: car.id,
      regionId: regions["castletown"].id,
      title: "2020 Kia Sportage 1.6 GDi 2 – Family SUV",
      description: "Well-specced Kia Sportage in good condition. Needs admin approval before going live.",
      price: 1599000,
      status: "PENDING",
      expiresAt: null,
      createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    },
  });
  await prisma.payment.create({
    data: {
      listingId: pendingListing.id,
      stripePaymentId: `demo_pi_pending_${pendingListing.id}`,
      amount: 499,
      currency: "gbp",
      status: "SUCCEEDED",
      idempotencyKey: `demo_idem_pending_${pendingListing.id}`,
    },
  });

  console.log(`  Created ${17 + generatedCount} listings (${16 + generatedCount} LIVE vehicles, 1 PENDING)`);
  console.log("\nSeed completed successfully!");
  console.log("Admin login: admin@itrader.im (demo_admin_001)");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

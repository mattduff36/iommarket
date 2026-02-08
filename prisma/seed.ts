import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const raw =
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.DATABASE_URL ??
  "";
const pool = new pg.Pool({
  connectionString: raw.trim(),
  ssl: { rejectUnauthorized: false },
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/**
 * Comprehensive seed for IOM Market demo.
 * Creates regions, categories, attributes, users, dealers, and ~25 LIVE listings
 * with placeholder images so the site looks populated for client demos.
 */
async function main() {
  console.log("Seeding IOM Market database...\n");

  // ---------------------------------------------------------------------------
  // Regions (Isle of Man towns)
  // ---------------------------------------------------------------------------
  const regionData = [
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
  // Categories
  // ---------------------------------------------------------------------------
  const vehicles = await prisma.category.upsert({
    where: { slug: "vehicles" },
    update: {},
    create: { name: "Vehicles", slug: "vehicles", sortOrder: 1 },
  });

  const marine = await prisma.category.upsert({
    where: { slug: "marine" },
    update: {},
    create: { name: "Marine", slug: "marine", sortOrder: 2 },
  });

  const hifi = await prisma.category.upsert({
    where: { slug: "hifi-home-av" },
    update: {},
    create: { name: "HiFi / Home AV", slug: "hifi-home-av", sortOrder: 3 },
  });

  const instruments = await prisma.category.upsert({
    where: { slug: "instruments" },
    update: {},
    create: { name: "Instruments", slug: "instruments", sortOrder: 4 },
  });

  const photography = await prisma.category.upsert({
    where: { slug: "photography" },
    update: {},
    create: { name: "Photography", slug: "photography", sortOrder: 5 },
  });

  console.log("  Created 5 categories");

  // ---------------------------------------------------------------------------
  // Vehicle attribute definitions
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
      options: JSON.stringify(["Petrol", "Diesel", "Electric", "Hybrid"]),
    },
    {
      name: "Transmission",
      slug: "transmission",
      dataType: "select",
      required: false,
      sortOrder: 6,
      options: JSON.stringify(["Manual", "Automatic"]),
    },
  ];

  const vehicleAttrs: Record<string, { id: string }> = {};
  for (const attr of vehicleAttrDefs) {
    const created = await prisma.attributeDefinition.upsert({
      where: { categoryId_slug: { categoryId: vehicles.id, slug: attr.slug } },
      update: {},
      create: {
        categoryId: vehicles.id,
        name: attr.name,
        slug: attr.slug,
        dataType: attr.dataType,
        required: attr.required,
        sortOrder: attr.sortOrder,
        options: (attr as { options?: string }).options ?? null,
      },
    });
    vehicleAttrs[attr.slug] = created;
  }
  console.log("  Created 6 vehicle attributes");

  // Marine attributes
  const marineAttrDefs = [
    { name: "Boat Type", slug: "boat-type", dataType: "select", required: true, sortOrder: 1, options: JSON.stringify(["Sailboat", "Motorboat", "RIB", "Kayak/Canoe", "Jet Ski", "Fishing Boat"]) },
    { name: "Length (ft)", slug: "length-ft", dataType: "number", required: false, sortOrder: 2 },
    { name: "Year", slug: "year", dataType: "number", required: false, sortOrder: 3 },
    { name: "Engine", slug: "engine", dataType: "text", required: false, sortOrder: 4 },
  ];

  const marineAttrs: Record<string, { id: string }> = {};
  for (const attr of marineAttrDefs) {
    const created = await prisma.attributeDefinition.upsert({
      where: { categoryId_slug: { categoryId: marine.id, slug: attr.slug } },
      update: {},
      create: {
        categoryId: marine.id,
        name: attr.name,
        slug: attr.slug,
        dataType: attr.dataType,
        required: attr.required,
        sortOrder: attr.sortOrder,
        options: (attr as { options?: string }).options ?? null,
      },
    });
    marineAttrs[attr.slug] = created;
  }
  console.log("  Created 4 marine attributes");

  // ---------------------------------------------------------------------------
  // Demo users
  // ---------------------------------------------------------------------------
  const demoUsers = [
    { clerkId: "demo_user_001", email: "john.quayle@example.im", name: "John Quayle", role: "SELLER" as const },
    { clerkId: "demo_user_002", email: "sarah.craine@example.im", name: "Sarah Craine", role: "SELLER" as const },
    { clerkId: "demo_user_003", email: "mark.kelly@example.im", name: "Mark Kelly", role: "SELLER" as const },
    { clerkId: "demo_user_004", email: "emma.corlett@example.im", name: "Emma Corlett", role: "SELLER" as const },
    { clerkId: "demo_dealer_001", email: "info@manxmotors.im", name: "Manx Motors Ltd", role: "DEALER" as const },
    { clerkId: "demo_dealer_002", email: "info@islandmarine.im", name: "Island Marine Services", role: "DEALER" as const },
    { clerkId: "demo_dealer_003", email: "sales@soundisland.im", name: "Sound Island Audio", role: "DEALER" as const },
    { clerkId: "demo_user_005", email: "david.shimmin@example.im", name: "David Shimmin", role: "SELLER" as const },
    { clerkId: "demo_user_006", email: "fiona.clague@example.im", name: "Fiona Clague", role: "SELLER" as const },
    { clerkId: "demo_admin_001", email: "admin@iommarket.im", name: "IOM Market Admin", role: "ADMIN" as const },
  ];

  const users: Record<string, { id: string }> = {};
  for (const u of demoUsers) {
    const user = await prisma.user.upsert({
      where: { clerkId: u.clerkId },
      update: {},
      create: {
        clerkId: u.clerkId,
        email: u.email,
        name: u.name,
        role: u.role,
        regionId: regions["douglas"].id,
      },
    });
    users[u.clerkId] = user;
  }
  console.log(`  Created ${demoUsers.length} users`);

  // ---------------------------------------------------------------------------
  // Dealer profiles
  // ---------------------------------------------------------------------------
  const manxMotors = await prisma.dealerProfile.upsert({
    where: { slug: "manx-motors" },
    update: {},
    create: {
      userId: users["demo_dealer_001"].id,
      name: "Manx Motors Ltd",
      slug: "manx-motors",
      bio: "The Isle of Man's premier used car dealership. We've been serving the island for over 15 years with quality pre-owned vehicles, full service history checks, and honest pricing. Visit our showroom on Peel Road, Douglas.",
      website: "https://manxmotors.example.im",
      phone: "01624 612345",
    },
  });

  const islandMarine = await prisma.dealerProfile.upsert({
    where: { slug: "island-marine" },
    update: {},
    create: {
      userId: users["demo_dealer_002"].id,
      name: "Island Marine Services",
      slug: "island-marine",
      bio: "Specialists in marine sales and servicing on the Isle of Man. From dinghies to motor cruisers, we handle sales, maintenance, and winter storage at our Peel marina facility.",
      website: "https://islandmarine.example.im",
      phone: "01624 843210",
    },
  });

  const soundIsland = await prisma.dealerProfile.upsert({
    where: { slug: "sound-island" },
    update: {},
    create: {
      userId: users["demo_dealer_003"].id,
      name: "Sound Island Audio",
      slug: "sound-island",
      bio: "Hi-fi enthusiasts serving the Isle of Man. We stock premium audio equipment from brands like Naim, Rega, KEF, and more. Demo room available by appointment in Onchan.",
      phone: "01624 675890",
    },
  });

  console.log("  Created 3 dealer profiles");

  // Dealer subscriptions (active)
  for (const dealer of [manxMotors, islandMarine, soundIsland]) {
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
  // Placeholder images (Unsplash – high quality, no API key required for hotlinks)
  // ---------------------------------------------------------------------------
  const IMG = {
    // Vehicles
    bmw3: "https://images.unsplash.com/photo-1555215695-3004980ad54e?w=800&h=600&fit=crop",
    audi: "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=800&h=600&fit=crop",
    vw:   "https://images.unsplash.com/photo-1583267746897-2cf415887172?w=800&h=600&fit=crop",
    mini: "https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=800&h=600&fit=crop",
    landrover: "https://images.unsplash.com/photo-1606016159991-dfe4f2746ad5?w=800&h=600&fit=crop",
    tesla: "https://images.unsplash.com/photo-1560958089-b8a1929cea89?w=800&h=600&fit=crop",
    ford: "https://images.unsplash.com/photo-1551830820-330a71b99659?w=800&h=600&fit=crop",
    merc: "https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?w=800&h=600&fit=crop",
    porsche: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=800&h=600&fit=crop",
    // Marine
    sailboat: "https://images.unsplash.com/photo-1540946485063-a40da27545f8?w=800&h=600&fit=crop",
    motorboat: "https://images.unsplash.com/photo-1567899378494-47b22a2ae96a?w=800&h=600&fit=crop",
    rib: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800&h=600&fit=crop",
    jetski: "https://images.unsplash.com/photo-1626447857058-2ba6a8868cb5?w=800&h=600&fit=crop",
    // HiFi
    turntable: "https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=800&h=600&fit=crop",
    speakers: "https://images.unsplash.com/photo-1545454675-3531b543be5d?w=800&h=600&fit=crop",
    amp: "https://images.unsplash.com/photo-1558089687-f282ffcbc126?w=800&h=600&fit=crop",
    headphones: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&h=600&fit=crop",
    // Instruments
    guitar: "https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=800&h=600&fit=crop",
    piano: "https://images.unsplash.com/photo-1520523839897-bd0b52f945a0?w=800&h=600&fit=crop",
    drums: "https://images.unsplash.com/photo-1519892300165-cb5542fb47c7?w=800&h=600&fit=crop",
    violin: "https://images.unsplash.com/photo-1612225330812-01a9c73fcbdc?w=800&h=600&fit=crop",
    // Photography
    camera1: "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=800&h=600&fit=crop",
    camera2: "https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=800&h=600&fit=crop",
    lens: "https://images.unsplash.com/photo-1617005082133-548c4dd27f35?w=800&h=600&fit=crop",
    drone: "https://images.unsplash.com/photo-1473968512647-3e447244af8f?w=800&h=600&fit=crop",
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

  // --- VEHICLES (10 listings) ---

  await createListing({
    userId: users["demo_dealer_001"].id,
    dealerId: manxMotors.id,
    categoryId: vehicles.id,
    regionSlug: "douglas",
    title: "2021 BMW 320d M Sport – Immaculate Condition",
    description: "One owner from new, full BMW service history. This stunning 320d M Sport comes in Mineral Grey with black Dakota leather interior. Features include M Sport suspension, professional navigation, Harman Kardon sound system, and rear parking camera. MOT until March 2027. Excellent condition throughout – must be seen.",
    price: 24995,
    featured: true,
    imageUrl: IMG.bmw3,
    attributes: [
      { attrId: vehicleAttrs["make"].id, value: "BMW" },
      { attrId: vehicleAttrs["model"].id, value: "320d M Sport" },
      { attrId: vehicleAttrs["year"].id, value: "2021" },
      { attrId: vehicleAttrs["mileage"].id, value: "34200" },
      { attrId: vehicleAttrs["fuel-type"].id, value: "Diesel" },
      { attrId: vehicleAttrs["transmission"].id, value: "Automatic" },
    ],
    daysAgo: 2,
  });

  await createListing({
    userId: users["demo_dealer_001"].id,
    dealerId: manxMotors.id,
    categoryId: vehicles.id,
    regionSlug: "douglas",
    title: "2020 Audi A4 35 TFSI S Line – Low Miles",
    description: "Beautiful Audi A4 S Line in Navarra Blue. Features virtual cockpit, LED headlights, 3-zone climate control, and Audi smartphone interface. Only 28,000 miles. Two keys, full Audi service history. Finance available.",
    price: 22450,
    featured: true,
    imageUrl: IMG.audi,
    attributes: [
      { attrId: vehicleAttrs["make"].id, value: "Audi" },
      { attrId: vehicleAttrs["model"].id, value: "A4 35 TFSI S Line" },
      { attrId: vehicleAttrs["year"].id, value: "2020" },
      { attrId: vehicleAttrs["mileage"].id, value: "28100" },
      { attrId: vehicleAttrs["fuel-type"].id, value: "Petrol" },
      { attrId: vehicleAttrs["transmission"].id, value: "Automatic" },
    ],
    daysAgo: 3,
  });

  await createListing({
    userId: users["demo_user_001"].id,
    categoryId: vehicles.id,
    regionSlug: "ramsey",
    title: "2018 VW Golf 1.5 TSI Match – Great Runner",
    description: "Reliable family hatchback in very good condition. Glacier White, cloth seats, touchscreen infotainment with Apple CarPlay. 4 new tyres fitted recently. Selling as upgrading to something larger. Any inspection welcome.",
    price: 12750,
    imageUrl: IMG.vw,
    attributes: [
      { attrId: vehicleAttrs["make"].id, value: "Volkswagen" },
      { attrId: vehicleAttrs["model"].id, value: "Golf 1.5 TSI Match" },
      { attrId: vehicleAttrs["year"].id, value: "2018" },
      { attrId: vehicleAttrs["mileage"].id, value: "52300" },
      { attrId: vehicleAttrs["fuel-type"].id, value: "Petrol" },
      { attrId: vehicleAttrs["transmission"].id, value: "Manual" },
    ],
    daysAgo: 5,
  });

  await createListing({
    userId: users["demo_dealer_001"].id,
    dealerId: manxMotors.id,
    categoryId: vehicles.id,
    regionSlug: "douglas",
    title: "2022 Tesla Model 3 Long Range – Island Perfect",
    description: "Stunning Pearl White Tesla Model 3 Long Range AWD. Over 300 miles range, autopilot, premium interior with heated seats front and rear. Perfect for island driving – charge at home overnight. Low road tax. Full Tesla warranty remaining.",
    price: 33995,
    featured: true,
    imageUrl: IMG.tesla,
    attributes: [
      { attrId: vehicleAttrs["make"].id, value: "Tesla" },
      { attrId: vehicleAttrs["model"].id, value: "Model 3 Long Range" },
      { attrId: vehicleAttrs["year"].id, value: "2022" },
      { attrId: vehicleAttrs["mileage"].id, value: "18500" },
      { attrId: vehicleAttrs["fuel-type"].id, value: "Electric" },
      { attrId: vehicleAttrs["transmission"].id, value: "Automatic" },
    ],
    daysAgo: 1,
  });

  await createListing({
    userId: users["demo_user_002"].id,
    categoryId: vehicles.id,
    regionSlug: "peel",
    title: "2017 MINI Cooper S 3-Door – Fun Island Car",
    description: "Chili Red MINI Cooper S with John Cooper Works bodykit. Heated seats, satellite navigation, Harman Kardon speakers. Fast and fun but also economical. Genuine reason for sale – emigrating. Priced to sell quickly.",
    price: 11500,
    imageUrl: IMG.mini,
    attributes: [
      { attrId: vehicleAttrs["make"].id, value: "MINI" },
      { attrId: vehicleAttrs["model"].id, value: "Cooper S" },
      { attrId: vehicleAttrs["year"].id, value: "2017" },
      { attrId: vehicleAttrs["mileage"].id, value: "45600" },
      { attrId: vehicleAttrs["fuel-type"].id, value: "Petrol" },
      { attrId: vehicleAttrs["transmission"].id, value: "Manual" },
    ],
    daysAgo: 7,
  });

  await createListing({
    userId: users["demo_dealer_001"].id,
    dealerId: manxMotors.id,
    categoryId: vehicles.id,
    regionSlug: "douglas",
    title: "2019 Land Rover Discovery Sport HSE – 7 Seater",
    description: "Versatile 7-seat SUV in Corris Grey. HSE spec includes leather, panoramic roof, touchscreen pro nav, 360-degree parking aid. Ideal for island families. Full Land Rover service history, cam belt done at 60k.",
    price: 28750,
    imageUrl: IMG.landrover,
    attributes: [
      { attrId: vehicleAttrs["make"].id, value: "Land Rover" },
      { attrId: vehicleAttrs["model"].id, value: "Discovery Sport HSE" },
      { attrId: vehicleAttrs["year"].id, value: "2019" },
      { attrId: vehicleAttrs["mileage"].id, value: "61200" },
      { attrId: vehicleAttrs["fuel-type"].id, value: "Diesel" },
      { attrId: vehicleAttrs["transmission"].id, value: "Automatic" },
    ],
    daysAgo: 4,
  });

  await createListing({
    userId: users["demo_user_003"].id,
    categoryId: vehicles.id,
    regionSlug: "castletown",
    title: "2015 Ford Fiesta 1.0 EcoBoost Zetec – First Car Special",
    description: "Perfect first car or runabout. Well maintained, MOT until October. Metallic blue, Bluetooth, air con, electric windows. Cheap to run and insure. Slight dent on rear quarter – reflected in price.",
    price: 5995,
    imageUrl: IMG.ford,
    attributes: [
      { attrId: vehicleAttrs["make"].id, value: "Ford" },
      { attrId: vehicleAttrs["model"].id, value: "Fiesta 1.0 EcoBoost Zetec" },
      { attrId: vehicleAttrs["year"].id, value: "2015" },
      { attrId: vehicleAttrs["mileage"].id, value: "78400" },
      { attrId: vehicleAttrs["fuel-type"].id, value: "Petrol" },
      { attrId: vehicleAttrs["transmission"].id, value: "Manual" },
    ],
    daysAgo: 10,
  });

  await createListing({
    userId: users["demo_dealer_001"].id,
    dealerId: manxMotors.id,
    categoryId: vehicles.id,
    regionSlug: "douglas",
    title: "2023 Mercedes-Benz A-Class A200 AMG Line – Nearly New",
    description: "Delivery miles only on this stunning Cosmos Black A-Class. AMG Line styling, MBUX infotainment with touchscreen, LED high performance headlights, ambient lighting, reversing camera. Manufacturer warranty until 2026.",
    price: 29995,
    imageUrl: IMG.merc,
    attributes: [
      { attrId: vehicleAttrs["make"].id, value: "Mercedes-Benz" },
      { attrId: vehicleAttrs["model"].id, value: "A200 AMG Line" },
      { attrId: vehicleAttrs["year"].id, value: "2023" },
      { attrId: vehicleAttrs["mileage"].id, value: "3200" },
      { attrId: vehicleAttrs["fuel-type"].id, value: "Petrol" },
      { attrId: vehicleAttrs["transmission"].id, value: "Automatic" },
    ],
    daysAgo: 1,
  });

  await createListing({
    userId: users["demo_user_005"].id,
    categoryId: vehicles.id,
    regionSlug: "onchan",
    title: "2016 Porsche Cayman 718 – Weekend Toy",
    description: "Guards Red 718 Cayman with extended leather in Black. Sport Chrono package, PASM sport suspension, BOSE surround sound. Garaged, only used on dry days. HPI clear. A true driver's car for someone who appreciates the finer things.",
    price: 38500,
    featured: true,
    imageUrl: IMG.porsche,
    attributes: [
      { attrId: vehicleAttrs["make"].id, value: "Porsche" },
      { attrId: vehicleAttrs["model"].id, value: "718 Cayman" },
      { attrId: vehicleAttrs["year"].id, value: "2016" },
      { attrId: vehicleAttrs["mileage"].id, value: "22100" },
      { attrId: vehicleAttrs["fuel-type"].id, value: "Petrol" },
      { attrId: vehicleAttrs["transmission"].id, value: "Manual" },
    ],
    daysAgo: 3,
  });

  // --- MARINE (4 listings) ---

  await createListing({
    userId: users["demo_dealer_002"].id,
    dealerId: islandMarine.id,
    categoryId: marine.id,
    regionSlug: "peel",
    title: "Bayliner 285 Cruiser – Ready for Season",
    description: "Well-maintained Bayliner 285 with Mercruiser 5.0L V8. Sleeps 4 in comfortable cabin with galley and marine heads. Full bimini and cockpit covers. Lying Peel harbour, can be viewed afloat. New anodes and antifoul for 2026 season.",
    price: 32000,
    featured: true,
    imageUrl: IMG.motorboat,
    attributes: [
      { attrId: marineAttrs["boat-type"].id, value: "Motorboat" },
      { attrId: marineAttrs["length-ft"].id, value: "28" },
      { attrId: marineAttrs["year"].id, value: "2015" },
      { attrId: marineAttrs["engine"].id, value: "Mercruiser 5.0L V8" },
    ],
    daysAgo: 4,
  });

  await createListing({
    userId: users["demo_dealer_002"].id,
    dealerId: islandMarine.id,
    categoryId: marine.id,
    regionSlug: "peel",
    title: "Humber Destroyer 6.0m RIB – Fast Tender",
    description: "2019 Humber Destroyer RIB with Mercury 115HP 4-stroke outboard. A-frame, GPS, fish finder, console with windscreen. Extremely capable boat, perfect for fishing or fast transfer around the island. On galvanised trailer.",
    price: 18500,
    imageUrl: IMG.rib,
    attributes: [
      { attrId: marineAttrs["boat-type"].id, value: "RIB" },
      { attrId: marineAttrs["length-ft"].id, value: "20" },
      { attrId: marineAttrs["year"].id, value: "2019" },
      { attrId: marineAttrs["engine"].id, value: "Mercury 115HP 4-stroke" },
    ],
    daysAgo: 8,
  });

  await createListing({
    userId: users["demo_user_004"].id,
    categoryId: marine.id,
    regionSlug: "port-erin",
    title: "Contessa 32 Sailing Yacht – Classic Cruiser",
    description: "Much-loved Contessa 32, extensively refitted 2022. New standing rigging, roller furling genoa, Yanmar 2GM20F diesel (low hours). Perfect for exploring the Irish Sea from the Isle of Man. Moored Port Erin, available for sea trial.",
    price: 22500,
    imageUrl: IMG.sailboat,
    attributes: [
      { attrId: marineAttrs["boat-type"].id, value: "Sailboat" },
      { attrId: marineAttrs["length-ft"].id, value: "32" },
      { attrId: marineAttrs["year"].id, value: "1978" },
      { attrId: marineAttrs["engine"].id, value: "Yanmar 2GM20F" },
    ],
    daysAgo: 12,
  });

  await createListing({
    userId: users["demo_user_001"].id,
    categoryId: marine.id,
    regionSlug: "ramsey",
    title: "Yamaha WaveRunner EX – Low Hours",
    description: "2021 Yamaha WaveRunner EX with only 42 hours. Incredibly fun on calm days around the island. Includes double trailer, cover, and life jackets. Stored indoors over winter. Reluctant sale – new baby means no time!",
    price: 6500,
    imageUrl: IMG.jetski,
    attributes: [
      { attrId: marineAttrs["boat-type"].id, value: "Jet Ski" },
      { attrId: marineAttrs["year"].id, value: "2021" },
      { attrId: marineAttrs["engine"].id, value: "Yamaha TR-1 3-cyl" },
    ],
    daysAgo: 6,
  });

  // --- HI-FI / HOME AV (4 listings) ---

  await createListing({
    userId: users["demo_dealer_003"].id,
    dealerId: soundIsland.id,
    categoryId: hifi.id,
    regionSlug: "onchan",
    title: "Naim Supernait 3 Integrated Amplifier – Ex-Demo",
    description: "Ex-demonstration Naim Supernait 3 in perfect condition with full manufacturer warranty. This is Naim's flagship integrated amp – 80W per channel of pure musical bliss. Includes original packaging and Naim power lead. RRP £3,499 – save over £700.",
    price: 2795,
    featured: true,
    imageUrl: IMG.amp,
    attributes: [],
    daysAgo: 2,
  });

  await createListing({
    userId: users["demo_dealer_003"].id,
    dealerId: soundIsland.id,
    categoryId: hifi.id,
    regionSlug: "onchan",
    title: "KEF LS50 Meta Bookshelf Speakers – Mineral White",
    description: "Award-winning KEF LS50 Meta speakers in Mineral White. These have been used in our demo room for 6 months and are in mint condition. The LS50 Meta is widely regarded as the best bookshelf speaker under £1,500. Includes original boxes.",
    price: 795,
    imageUrl: IMG.speakers,
    attributes: [],
    daysAgo: 5,
  });

  await createListing({
    userId: users["demo_user_006"].id,
    categoryId: hifi.id,
    regionSlug: "douglas",
    title: "Rega Planar 3 Turntable with Elys 2 – Boxed",
    description: "2023 Rega Planar 3 in gloss white with factory-fitted Elys 2 cartridge. Used for approximately 200 hours. Exceptional vinyl playback – upgrading to a Planar 8 so this beauty needs a new home. Smoke-free, pet-free house.",
    price: 499,
    imageUrl: IMG.turntable,
    attributes: [],
    daysAgo: 9,
  });

  await createListing({
    userId: users["demo_user_003"].id,
    categoryId: hifi.id,
    regionSlug: "laxey",
    title: "Sennheiser HD 800 S Reference Headphones",
    description: "The legendary Sennheiser HD 800 S open-back headphones. Purchased 2022, very lightly used – I'm more of a speaker person. Includes balanced 4.4mm cable and original 6.35mm cable. Superb condition with case.",
    price: 895,
    imageUrl: IMG.headphones,
    attributes: [],
    daysAgo: 14,
  });

  // --- INSTRUMENTS (4 listings) ---

  await createListing({
    userId: users["demo_user_002"].id,
    categoryId: instruments.id,
    regionSlug: "douglas",
    title: "Fender American Professional II Stratocaster – Sunburst",
    description: "2022 Fender American Professional II Strat in 3-Colour Sunburst with rosewood fingerboard. V-Mod II single-coil pickups, push-push tone control for neck pickup. Includes Fender Elite moulded case. No dings, played at home only.",
    price: 1250,
    imageUrl: IMG.guitar,
    attributes: [],
    daysAgo: 3,
  });

  await createListing({
    userId: users["demo_user_004"].id,
    categoryId: instruments.id,
    regionSlug: "port-st-mary",
    title: "Yamaha U1 Upright Piano – Reconditioned",
    description: "Fully reconditioned Yamaha U1 in polished ebony. New hammers, re-strung, case re-polished. The U1 is the world's most popular upright piano and this one plays beautifully. Buyer collects – ground floor access. Tuned to concert pitch.",
    price: 3200,
    imageUrl: IMG.piano,
    attributes: [],
    daysAgo: 7,
  });

  await createListing({
    userId: users["demo_user_005"].id,
    categoryId: instruments.id,
    regionSlug: "onchan",
    title: "Roland TD-17KVX V-Drums Electronic Kit",
    description: "Complete Roland electronic drum kit with mesh heads. Perfect for practising without annoying the neighbours. Includes throne, kick pedal, hi-hat stand, headphones. All pads in great condition. Ideal for island living where noise is a concern!",
    price: 895,
    imageUrl: IMG.drums,
    attributes: [],
    daysAgo: 11,
  });

  await createListing({
    userId: users["demo_user_006"].id,
    categoryId: instruments.id,
    regionSlug: "ballasalla",
    title: "Stentor Conservatoire Violin 4/4 – Student Upgrade",
    description: "Excellent intermediate violin outfit. Solid tonewoods, ebony fittings, octagonal carbon fibre bow. Includes quality oblong case with shoulder rest. My daughter has progressed to a full professional instrument. Great for a serious student.",
    price: 350,
    imageUrl: IMG.violin,
    attributes: [],
    daysAgo: 16,
  });

  // --- PHOTOGRAPHY (4 listings) ---

  await createListing({
    userId: users["demo_user_001"].id,
    categoryId: photography.id,
    regionSlug: "douglas",
    title: "Sony A7 IV Mirrorless Camera Body – Mint",
    description: "Sony A7 IV body only, purchased January 2024. Shutter count under 5,000. 33MP full-frame sensor, incredible autofocus, 4K 60p video. Includes 2 batteries, original charger, strap, and box. Selling to fund a different system.",
    price: 1650,
    featured: true,
    imageUrl: IMG.camera1,
    attributes: [],
    daysAgo: 4,
  });

  await createListing({
    userId: users["demo_user_003"].id,
    categoryId: photography.id,
    regionSlug: "laxey",
    title: "Canon EF 70-200mm f/2.8L IS III USM Lens",
    description: "The legendary Canon 70-200 f/2.8L III. Professional workhorse lens with image stabilisation. Perfect for wildlife, portraits, and TT racing photography. Some minor dust externally but optically perfect. Hood and caps included.",
    price: 1295,
    imageUrl: IMG.lens,
    attributes: [],
    daysAgo: 6,
  });

  await createListing({
    userId: users["demo_user_005"].id,
    categoryId: photography.id,
    regionSlug: "kirk-michael",
    title: "DJI Mini 4 Pro Fly More Combo – All Accessories",
    description: "DJI Mini 4 Pro with Fly More kit (3 batteries, charging hub, shoulder bag). Under 250g so no licence required. 4K HDR video, obstacle avoidance, 34-min flight time. Perfect for aerial photography around the island's stunning coastline.",
    price: 699,
    imageUrl: IMG.drone,
    attributes: [],
    daysAgo: 8,
  });

  await createListing({
    userId: users["demo_user_002"].id,
    categoryId: photography.id,
    regionSlug: "peel",
    title: "Fujifilm X-T5 + 18-55mm Kit – Retro Beauty",
    description: "Gorgeous Fujifilm X-T5 in silver with the XF 18-55mm f/2.8-4 kit lens. 40MP APS-C sensor with stunning Fujifilm colour science. Film simulations are incredible straight out of camera. Less than 2,000 shutter actuations.",
    price: 1395,
    imageUrl: IMG.camera2,
    attributes: [],
    daysAgo: 5,
  });

  // --- One PENDING listing for admin demo ---
  const pendingListing = await prisma.listing.create({
    data: {
      userId: users["demo_user_004"].id,
      categoryId: vehicles.id,
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

  console.log("  Created 26 listings (25 LIVE, 1 PENDING)");
  console.log("\nSeed completed successfully!");
  console.log("Admin login: admin@iommarket.im (demo_admin_001)");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

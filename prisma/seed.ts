import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Regions
  const iom = await prisma.region.upsert({
    where: { slug: "isle-of-man" },
    update: {},
    create: { name: "Isle of Man", slug: "isle-of-man", active: true },
  });

  // Categories
  const vehicles = await prisma.category.upsert({
    where: { slug: "vehicles" },
    update: {},
    create: { name: "Vehicles", slug: "vehicles", sortOrder: 1 },
  });

  await prisma.category.upsert({
    where: { slug: "marine" },
    update: {},
    create: { name: "Marine", slug: "marine", sortOrder: 2 },
  });

  await prisma.category.upsert({
    where: { slug: "hifi-home-av" },
    update: {},
    create: { name: "HiFi / Home AV", slug: "hifi-home-av", sortOrder: 3 },
  });

  await prisma.category.upsert({
    where: { slug: "instruments" },
    update: {},
    create: { name: "Instruments", slug: "instruments", sortOrder: 4 },
  });

  await prisma.category.upsert({
    where: { slug: "photography" },
    update: {},
    create: { name: "Photography", slug: "photography", sortOrder: 5 },
  });

  // Vehicle attribute definitions
  const vehicleAttrs = [
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

  for (const attr of vehicleAttrs) {
    await prisma.attributeDefinition.upsert({
      where: {
        categoryId_slug: {
          categoryId: vehicles.id,
          slug: attr.slug,
        },
      },
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
  }

  console.log("Seed completed: regions, categories, and attribute definitions created.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

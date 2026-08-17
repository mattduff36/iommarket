import { getMakes, getModels } from "@meterapp/vehicle-db";
import {
  applyVehicleCatalogueImport,
  previewVehicleCatalogueImport,
} from "@/lib/vehicle-catalogue/import";
import { normalizeCatalogueName } from "@/lib/vehicle-catalogue/normalize";
import {
  VEHICLE_CATALOGUE_IMPORT_LIMITS,
  vehicleCatalogueImportSchema,
} from "@/lib/validations/vehicle-catalogue";

const SOURCE = "iommarket-uk-iom-baseline";
const SOURCE_VERSION = "2026-08-17.1+meterapp-vehicle-db-2.3.0";
const BASELINE_IMPORTED_AT = new Date("2026-08-17T00:00:00.000Z");
const CONFIRMATION = "IMPORT_UK_IOM_VEHICLE_CATALOGUE";
const COMMON_MAKES = [
  "Abarth",
  "Alfa Romeo",
  "Aprilia",
  "Audi",
  "Auto-Sleepers",
  "Auto-Trail",
  "Bailey",
  "BMW",
  "Citroen",
  "CUPRA",
  "Dacia",
  "Ducati",
  "Elddis",
  "Fiat",
  "Ford",
  "Harley-Davidson",
  "Honda",
  "Hymer",
  "Hyundai",
  "Iveco",
  "Jaguar",
  "Jeep",
  "Kawasaki",
  "Kia",
  "KTM",
  "Land Rover",
  "Lexus",
  "MAN",
  "Mazda",
  "Mercedes-Benz",
  "MG",
  "MINI",
  "Mitsubishi",
  "Nissan",
  "Peugeot",
  "Polestar",
  "Porsche",
  "Rapido",
  "Renault",
  "Roller Team",
  "Royal Enfield",
  "SEAT",
  "Skoda",
  "Subaru",
  "Suzuki",
  "Swift",
  "Tesla",
  "Toyota",
  "Triumph",
  "Vauxhall",
  "Volkswagen",
  "Volvo",
  "Yamaha",
] as const;

const REQUIRED_MODELS: Record<string, string[]> = {
  Aprilia: ["RS 660", "RSV4", "Tuono", "Tuareg"],
  Audi: ["A1", "A3", "A4", "Q3", "Q5"],
  BMW: [
    "1 Series",
    "3 Series",
    "5 Series",
    "R 1250 GS",
    "S 1000 RR",
    "X1",
    "X3",
    "X5",
  ],
  Citroen: ["Berlingo", "Dispatch", "Relay"],
  Ducati: ["Monster", "Multistrada", "Panigale", "Scrambler"],
  Elddis: ["Accordo", "Autoquest", "Encore"],
  Fiat: ["Doblo", "Ducato", "Scudo"],
  Ford: ["Fiesta", "Focus", "Kuga", "Puma", "Transit"],
  Honda: ["CB500X", "CBR600RR", "Civic", "CR-V", "Jazz"],
  Hymer: ["B-Class", "Exsis", "Free", "Grand Canyon"],
  Iveco: ["Daily"],
  Kawasaki: ["Ninja", "Versys", "Vulcan", "Z900"],
  KTM: ["Duke", "Adventure", "Super Duke"],
  "Land Rover": ["Defender", "Discovery", "Range Rover", "Range Rover Evoque"],
  MAN: ["TGE"],
  "Mercedes-Benz": ["A-Class", "C-Class", "E-Class", "GLA", "GLC"],
  Nissan: ["Interstar", "Juke", "Leaf", "Primastar", "Qashqai", "Townstar", "X-Trail"],
  Peugeot: ["Boxer", "Expert", "Partner"],
  Renault: ["Kangoo", "Master", "Trafic"],
  "Royal Enfield": ["Bullet", "Classic", "Himalayan", "Interceptor"],
  Suzuki: ["GSX-R", "SV650", "V-Strom"],
  Swift: ["Escape", "Kon-Tiki", "Select"],
  Tesla: ["Model 3", "Model S", "Model X", "Model Y"],
  Toyota: ["Aygo", "Corolla", "Prius", "Proace", "RAV4", "Yaris"],
  Triumph: ["Bonneville", "Speed Triple", "Street Triple", "Tiger"],
  Vauxhall: ["Astra", "Corsa", "Crossland", "Mokka", "Vivaro"],
  Volkswagen: [
    "California",
    "Golf",
    "Grand California",
    "ID.3",
    "ID.4",
    "Polo",
    "T-Roc",
    "Tiguan",
    "Transporter",
  ],
  Yamaha: ["MT-07", "MT-09", "Tracer", "XMAX", "YZF-R1"],
  "Auto-Sleepers": ["Broadway", "Fairford", "Warwick"],
  "Auto-Trail": ["Apache", "F-Line", "Imala", "Tracker"],
  Bailey: ["Adamo", "Advance", "Autograph"],
  "Harley-Davidson": ["Fat Boy", "Iron 883", "Sportster", "Street Glide"],
  Rapido: ["C Series", "Distinction", "M Series"],
  "Roller Team": ["Auto-Roller", "Kronos", "Pegaso", "Zefiro"],
};

function uniqueNames(names: Iterable<string>) {
  const byKey = new Map<string, string>();
  for (const rawName of names) {
    const name = rawName.trim().replace(/\s+/g, " ");
    const key = normalizeCatalogueName(name);
    if (key && !byKey.has(key)) byKey.set(key, name);
  }
  return [...byKey.values()].sort((a, b) =>
    a.localeCompare(b, "en-GB", { numeric: true, sensitivity: "base" }),
  );
}

function buildPayload() {
  const sourceMakesByKey = new Map(
    getMakes().map((make) => [normalizeCatalogueName(make.makeName), make]),
  );

  return vehicleCatalogueImportSchema.parse({
    source: SOURCE,
    sourceVersion: SOURCE_VERSION,
    importedAt: BASELINE_IMPORTED_AT,
    deactivateMissing: false,
    makes: COMMON_MAKES.map((canonicalMake, makeIndex) => {
      const sourceMake = sourceMakesByKey.get(normalizeCatalogueName(canonicalMake));
      const sourceModels = sourceMake
        ? getModels({ makeId: sourceMake.makeId }).map((model) => model.modelName)
        : [];
      const requiredModels = uniqueNames(REQUIRED_MODELS[canonicalMake] ?? []);
      const requiredKeys = new Set(requiredModels.map(normalizeCatalogueName));
      const sourceOnlyModels = uniqueNames(sourceModels).filter(
        (model) => !requiredKeys.has(normalizeCatalogueName(model)),
      );
      const models = [...requiredModels, ...sourceOnlyModels].slice(
        0,
        VEHICLE_CATALOGUE_IMPORT_LIMITS.modelsPerMake,
      );

      return {
        name: canonicalMake,
        active: true,
        sortOrder: makeIndex * 10,
        models: models.map((model, modelIndex) => ({
          name: model,
          active: true,
          sortOrder: modelIndex * 10,
          aliases: [],
        })),
      };
    }),
  });
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has("--apply");
  const confirmation = process.argv
    .slice(2)
    .find((argument) => argument.startsWith("--confirm="))
    ?.slice("--confirm=".length);
  const payload = buildPayload();

  if (apply) {
    if (
      process.env.VEHICLE_CATALOGUE_ALLOW_WRITE !== "1" ||
      confirmation !== CONFIRMATION
    ) {
      throw new Error(
        `Write blocked. Set VEHICLE_CATALOGUE_ALLOW_WRITE=1 and pass --confirm=${CONFIRMATION}.`,
      );
    }
    const adminId = process.env.VEHICLE_CATALOGUE_ADMIN_ID?.trim();
    if (!adminId) {
      throw new Error("VEHICLE_CATALOGUE_ADMIN_ID is required for audited imports.");
    }
    const diff = await applyVehicleCatalogueImport(payload, adminId);
    console.info(JSON.stringify({ mode: "applied", source: SOURCE, version: SOURCE_VERSION, diff }, null, 2));
    return;
  }

  const diff = await previewVehicleCatalogueImport(payload);
  console.info(
    JSON.stringify(
      {
        mode: "dry-run",
        source: SOURCE,
        version: SOURCE_VERSION,
        importedAt: payload.importedAt,
        makes: payload.makes.length,
        diff,
        applyCommand:
          `VEHICLE_CATALOGUE_ALLOW_WRITE=1 VEHICLE_CATALOGUE_ADMIN_ID=<admin-cuid> npm run db:seed:vehicles -- --apply --confirm=${CONFIRMATION}`,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Vehicle catalogue seed failed.");
  process.exitCode = 1;
});

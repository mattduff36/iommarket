import * as fs from "fs";
import * as path from "path";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import {
  deleteImage,
  getCloudinaryConfig,
  IMAGE_CONSTRAINTS,
  LISTING_IMAGE_TARGET,
} from "../lib/upload/cloudinary";

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

const shouldApply = process.argv.includes("--apply");
const shouldDeleteOldAssets = process.argv.includes("--delete-old-assets");

interface CloudinaryUploadPayload {
  secure_url?: string;
  public_id?: string;
  error?: {
    message?: string;
  };
}

interface MigrationReportRow {
  imageId: string;
  listingId: string;
  oldUrl: string;
  oldPublicId: string;
  newUrl?: string;
  newPublicId?: string;
  status: "planned" | "updated" | "skipped" | "failed";
  reason?: string;
}

const raw = process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL ?? "";
if (!raw) throw new Error("Missing DATABASE_URL or POSTGRES_URL_NON_POOLING");

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

async function main() {
  const config = getCloudinaryConfig();
  if (!config.cloudName || !config.apiKey || !config.apiSecret) {
    throw new Error("Missing Cloudinary config. Set cloud name, API key, and API secret.");
  }

  const images = await prisma.listingImage.findMany({
    orderBy: [{ listingId: "asc" }, { order: "asc" }],
  });
  const report: MigrationReportRow[] = [];

  console.log(
    `${shouldApply ? "Applying" : "Planning"} ${LISTING_IMAGE_TARGET.aspectRatioLabel} standardisation for ${images.length} listing images.`
  );

  for (const image of images) {
    if (image.publicId.includes("/standardized/")) {
      report.push({
        imageId: image.id,
        listingId: image.listingId,
        oldUrl: image.url,
        oldPublicId: image.publicId,
        status: "skipped",
        reason: "Already has a standardized public ID.",
      });
      continue;
    }

    const transformedUrl = buildStandardizedDeliveryUrl(image.url, config.cloudName);
    if (!transformedUrl) {
      report.push({
        imageId: image.id,
        listingId: image.listingId,
        oldUrl: image.url,
        oldPublicId: image.publicId,
        status: "skipped",
        reason: "Not a Cloudinary image URL.",
      });
      continue;
    }

    if (!shouldApply) {
      report.push({
        imageId: image.id,
        listingId: image.listingId,
        oldUrl: image.url,
        oldPublicId: image.publicId,
        newPublicId: `${IMAGE_CONSTRAINTS.folder}/standardized/${image.id}`,
        status: "planned",
      });
      continue;
    }

    try {
      const uploaded = await uploadStandardizedImage({
        sourceUrl: transformedUrl,
        publicId: `standardized/${image.id}`,
        config,
      });

      await prisma.listingImage.update({
        where: { id: image.id },
        data: {
          url: uploaded.secureUrl,
          publicId: uploaded.publicId,
        },
      });

      if (shouldDeleteOldAssets && image.publicId.startsWith(`${IMAGE_CONSTRAINTS.folder}/`)) {
        await deleteImage(image.publicId);
      }

      report.push({
        imageId: image.id,
        listingId: image.listingId,
        oldUrl: image.url,
        oldPublicId: image.publicId,
        newUrl: uploaded.secureUrl,
        newPublicId: uploaded.publicId,
        status: "updated",
      });
    } catch (error) {
      report.push({
        imageId: image.id,
        listingId: image.listingId,
        oldUrl: image.url,
        oldPublicId: image.publicId,
        status: "failed",
        reason: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  writeReport(report);
  const updated = report.filter((row) => row.status === "updated").length;
  const planned = report.filter((row) => row.status === "planned").length;
  const skipped = report.filter((row) => row.status === "skipped").length;
  const failed = report.filter((row) => row.status === "failed").length;

  console.log(`Done. Updated: ${updated}. Planned: ${planned}. Skipped: ${skipped}. Failed: ${failed}.`);
  if (!shouldApply) console.log("Run with --apply to create Cloudinary assets and update database rows.");
}

function buildStandardizedDeliveryUrl(url: string, cloudName: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "res.cloudinary.com") return null;
    if (!parsed.pathname.startsWith(`/${cloudName}/image/upload/`)) return null;

    const transformation = [
      `w_${LISTING_IMAGE_TARGET.width}`,
      `h_${LISTING_IMAGE_TARGET.height}`,
      "c_fill",
      "g_auto",
      "f_webp",
      "q_auto",
    ].join(",");

    parsed.pathname = parsed.pathname.replace("/image/upload/", `/image/upload/${transformation}/`);
    return parsed.toString();
  } catch {
    return null;
  }
}

async function uploadStandardizedImage({
  sourceUrl,
  publicId,
  config,
}: {
  sourceUrl: string;
  publicId: string;
  config: ReturnType<typeof getCloudinaryConfig>;
}) {
  const timestamp = Math.round(Date.now() / 1000).toString();
  const uploadParams = {
    folder: IMAGE_CONSTRAINTS.folder,
    overwrite: "true",
    public_id: publicId,
    timestamp,
  };
  const signature = signCloudinaryParams(uploadParams, config.apiSecret);
  const body = new URLSearchParams({
    ...uploadParams,
    file: sourceUrl,
    api_key: config.apiKey,
    signature,
  });

  const response = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const payload = (await response.json().catch(() => null)) as CloudinaryUploadPayload | null;

  if (!response.ok || !payload?.secure_url || !payload.public_id) {
    throw new Error(payload?.error?.message ?? `Cloudinary upload failed with ${response.status}`);
  }

  return {
    secureUrl: payload.secure_url,
    publicId: payload.public_id,
  };
}

function signCloudinaryParams(params: Record<string, string>, apiSecret: string) {
  const signatureBase = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");

  return createHash("sha1").update(`${signatureBase}${apiSecret}`).digest("hex");
}

function writeReport(report: MigrationReportRow[]) {
  const reportDir = path.resolve(process.cwd(), "migration-reports");
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(
    reportDir,
    `standardize-listing-images-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Report written to ${reportPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

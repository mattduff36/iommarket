import { Prisma } from "@prisma/client";
import { isStagingOnlyFeatureEnabled } from "@/lib/deployment/environment";

export class CloneExternalEffectError extends Error {}

type Query = (sql: Prisma.Sql) => Promise<Array<Record<string, unknown>>>;

async function query(sql: Prisma.Sql): Promise<Array<Record<string, unknown>>> {
  const { db } = await import("@/lib/db");
  return db.$queryRaw(sql);
}

export async function externalEffectBlocked(input: {
  tables?: Array<{ table: string; rowKey: string }>;
  emails?: string[];
  mediaIds?: string[];
  paymentReferences?: string[];
}, runQuery: Query = query): Promise<boolean> {
  if (!isStagingOnlyFeatureEnabled()) return false;
  const present = await runQuery(Prisma.sql`SELECT to_regclass('staging_admin.database_sync_state') IS NOT NULL AS present`);
  if (present[0]?.present !== true) return false;
  const state = await runQuery(Prisma.sql`SELECT active_generation_id::text AS id FROM staging_admin.database_sync_state WHERE id = 1`);
  const generation = state[0]?.id;
  if (typeof generation !== "string" || !generation) return false;
  for (const item of input.tables ?? []) {
    const found = await runQuery(Prisma.sql`SELECT 1 FROM staging_admin.database_sync_provenance WHERE generation_id = ${generation}::uuid AND table_name = ${item.table} AND row_key = ${item.rowKey} LIMIT 1`);
    if (found.length) return true;
  }
  const emails = (input.emails ?? []).map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (emails.length) {
    const found = await runQuery(Prisma.sql`
      SELECT 1 FROM staging_admin.database_sync_provenance p
      JOIN public."User" u ON u.id = p.row_key
      WHERE p.generation_id = ${generation}::uuid AND p.table_name = 'User' AND lower(u.email) IN (${Prisma.join(emails)})
      UNION ALL
      SELECT 1 FROM staging_admin.database_sync_provenance p
      JOIN public."WaitlistUser" w ON w.id = p.row_key
      WHERE p.generation_id = ${generation}::uuid AND p.table_name = 'WaitlistUser' AND lower(w.email) IN (${Prisma.join(emails)})
      UNION ALL
      SELECT 1 FROM staging_admin.database_sync_provenance p
      JOIN public."DealerCorrespondenceSettings" d ON d.id = p.row_key
      WHERE p.generation_id = ${generation}::uuid AND p.table_name = 'DealerCorrespondenceSettings' AND lower(d."verifiedEmail") IN (${Prisma.join(emails)})
      UNION ALL
      SELECT 1 FROM staging_admin.database_sync_provenance p
      JOIN public."Report" r ON r.id = p.row_key
      WHERE p.generation_id = ${generation}::uuid AND p.table_name = 'Report' AND lower(r."reporterEmail") IN (${Prisma.join(emails)})
      LIMIT 1`);
    if (found.length) return true;
  }
  for (const mediaId of input.mediaIds ?? []) {
    const found = await runQuery(Prisma.sql`
      SELECT 1 FROM staging_admin.database_sync_provenance p
      JOIN public."ListingImage" i ON i.id = p.row_key
      WHERE p.generation_id = ${generation}::uuid AND p.table_name = 'ListingImage'
        AND (i."publicId" = ${mediaId} OR i."imageKitFileId" = ${mediaId} OR i.url = ${mediaId} OR i."imageKitFilePath" = ${mediaId})
      UNION ALL
      SELECT 1 FROM staging_admin.database_sync_provenance p
      JOIN public."ListingRevisionImage" i ON i.id = p.row_key
      WHERE p.generation_id = ${generation}::uuid AND p.table_name = 'ListingRevisionImage'
        AND (i."publicId" = ${mediaId} OR i."imageKitFileId" = ${mediaId} OR i.url = ${mediaId} OR i."imageKitFilePath" = ${mediaId})
      LIMIT 1`);
    if (found.length) return true;
  }
  for (const reference of input.paymentReferences ?? []) {
    const found = await runQuery(Prisma.sql`
      SELECT 1 FROM staging_admin.database_sync_provenance p
      JOIN public."Payment" payment ON payment.id = p.row_key
      WHERE p.generation_id = ${generation}::uuid AND p.table_name = 'Payment'
        AND (payment.id = ${reference} OR payment."providerPaymentId" = ${reference} OR payment."providerReference" = ${reference})
      LIMIT 1`);
    if (found.length) return true;
  }
  return false;
}

export async function assertExternalEffectAllowed(input: Parameters<typeof externalEffectBlocked>[0]): Promise<void> {
  try {
    if (await externalEffectBlocked(input)) {
      throw new CloneExternalEffectError("Cloned production records cannot trigger external effects from staging.");
    }
  } catch (error) {
    if (error instanceof CloneExternalEffectError) throw error;
    throw new CloneExternalEffectError("Cloned production data could not be checked. External effects were stopped.");
  }
}

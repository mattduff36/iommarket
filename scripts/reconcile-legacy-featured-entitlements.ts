/**
 * Reconcile the audited pre-entitlement FEATURED payments.
 *
 * Dry-run: npx tsx scripts/reconcile-legacy-featured-entitlements.ts --target preview
 * Apply:   npx tsx scripts/reconcile-legacy-featured-entitlements.ts --target preview --apply
 *
 * This script only marks historically consumed or synthetic payments as
 * consumed. It never grants Featured or changes listing state.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { databaseSslOptions } from "../lib/db/pool-options";
import {
  chooseDirectConnectionString,
  isAllowedSupabaseApiUrl,
} from "./prod-mirror/target";
import { PREVIEW_PROJECT_REF, PRODUCTION_PROJECT_REF } from "./prod-mirror/constants";

type Target = "preview" | "production";
type Classification = "synthetic-seed" | "applied-before-takedown";
type ManifestEntry = { id: string; listingId: string; classification: Classification; provider: "DEV" | "RIPPLE" };

// Captured from the reviewed featured-backfill-preview.json audit. The first
// 24 rows are synthetic seed payments; the final two have lifecycle evidence
// showing payment after approval and before a later take-down.
export const AUDITED_PREVIEW_PAYMENTS: readonly ManifestEntry[] = [
  { id: "cmtncup71006638zjy6atgtlt", listingId: "cmtncup5l005e38zjkegecodx", classification: "synthetic-seed", provider: "DEV" },
  { id: "cmtncuqx300ss38zjpv3zyn7b", listingId: "cmtncuqvc00s038zjj350r6uy", classification: "synthetic-seed", provider: "DEV" },
  { id: "cmtncurc600yh38zj6ylf1w6h", listingId: "cmtncurb600xp38zjlkhs29px", classification: "synthetic-seed", provider: "DEV" },
  { id: "cmtncurti014z38zjhyjd7ttr", listingId: "cmtncursf014738zjevx3uv3v", classification: "synthetic-seed", provider: "DEV" },
  { id: "cmtncusak01ao38zjf70kxx6w", listingId: "cmtncus9l019w38zjfcit1ghj", classification: "synthetic-seed", provider: "DEV" },
  { id: "cmtncuswh01is38zj6h0ti0ls", listingId: "cmtncusvd01i038zjrzgw0071", classification: "synthetic-seed", provider: "DEV" },
  { id: "cmtncut5l01m238zjf5575oiq", listingId: "cmtncut4101la38zjrfm3xpw4", classification: "synthetic-seed", provider: "DEV" },
  { id: "cmtncutgd01q538zjugcqajnn", listingId: "cmtncutf001pd38zjiiuucrjn", classification: "synthetic-seed", provider: "DEV" },
  { id: "cmtncutqn01tb38zjtn2jwg1e", listingId: "cmtncutpc01sk38zjyjvfy1vc", classification: "synthetic-seed", provider: "DEV" },
  { id: "cmtncuu1c01x938zjhbfigb7y", listingId: "cmtncuu0501wi38zj050vujtl", classification: "synthetic-seed", provider: "DEV" },
  { id: "cmtncuu9f020f38zjectsqvpp", listingId: "cmtncuu8801zo38zjtawdeubc", classification: "synthetic-seed", provider: "DEV" },
  { id: "cmtncuuky024738zjl4skk8gz", listingId: "cmtncuujl023i38zjf0whtlo6", classification: "synthetic-seed", provider: "DEV" },
  { id: "cmtncuvjs02fb38zjmxdij7fi", listingId: "cmtncuvip02ej38zjxepavf69", classification: "synthetic-seed", provider: "DEV" },
  { id: "cmtncuwjp02sm38zjic5dqrp5", listingId: "cmtncuwio02ru38zj8ehfbdgc", classification: "synthetic-seed", provider: "DEV" },
  { id: "cmtncuxlo035x38zj7fgs9xw7", listingId: "cmtncuxkg035538zjv468lwqg", classification: "synthetic-seed", provider: "DEV" },
  { id: "cmtncuyss03j838zjs7sxeyfx", listingId: "cmtncuyrp03ig38zjmkrv31bl", classification: "synthetic-seed", provider: "DEV" },
  { id: "cmtncuzzm03ws38zjkqxblub9", listingId: "cmtncuzxw03w138zj8gh0ay4d", classification: "synthetic-seed", provider: "DEV" },
  { id: "cmtncv12u049x38zj9qxw98nu", listingId: "cmtncv11v049838zjyy5x8ia5", classification: "synthetic-seed", provider: "DEV" },
  { id: "cmtncv2ce04mz38zjgdo1vja0", listingId: "cmtncv2be04m738zjxc79xqim", classification: "synthetic-seed", provider: "DEV" },
  { id: "cmtncv3hr050r38zj7c2w475d", listingId: "cmtncv3g104zz38zjvck71pz9", classification: "synthetic-seed", provider: "DEV" },
  { id: "cmtncv4nt05ej38zj7wt2y3tq", listingId: "cmtncv4mp05dr38zj7d6qcnd8", classification: "synthetic-seed", provider: "DEV" },
  { id: "cmtncv5x505sb38zju3yud2os", listingId: "cmtncv5ua05rj38zji5hg7ick", classification: "synthetic-seed", provider: "DEV" },
  { id: "cmtncv780065p38zj08jdltub", listingId: "cmtncv75y065238zjngld9hz9", classification: "synthetic-seed", provider: "DEV" },
  { id: "cmtncv8bg06ia38zjxzgxl65q", listingId: "cmtncv8ai06hl38zjklwq67q6", classification: "synthetic-seed", provider: "DEV" },
  { id: "cmunh413t000004ifqhjgt4hk", listingId: "cmunayvqe000004jw0brcawla", classification: "applied-before-takedown", provider: "RIPPLE" },
  { id: "cmuoq2na9000104l0gjsan3jz", listingId: "cmuol2024000204l2izhdy1p1", classification: "applied-before-takedown", provider: "DEV" },
];

export type AuditedPayment = {
  id: string;
  listingId: string;
  paymentProvider: string;
  providerReference: string | null;
  providerPaymentId: string | null;
  type: string;
  status: string;
  amount: number;
  currency: string;
  refundedAt: Date | null;
  featuredAppliedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastProviderEventAt: Date | null;
  lastProviderEventType: string | null;
  listing: {
    status: string;
    featured: boolean;
    statusEvents: Array<{ action: string | null; createdAt: Date }>;
  };
};

export function expectedManifest(target: Target): readonly ManifestEntry[] {
  return target === "preview" ? AUDITED_PREVIEW_PAYMENTS : [];
}

export function validateReconciliationSet(target: Target, rows: readonly AuditedPayment[]) {
  const manifest = expectedManifest(target);
  const expected = new Map(manifest.map((entry) => [entry.id, entry]));
  const actual = new Map(rows.map((row) => [row.id, row]));
  const unexpected = [...actual.keys()].filter((id) => !expected.has(id));
  const missing = [...expected.keys()].filter((id) => !actual.has(id));
  if (unexpected.length || missing.length || actual.size !== rows.length) {
    throw new Error(`Legacy Featured candidate set mismatch (unexpected=${unexpected.length}, missing=${missing.length}, duplicate=${rows.length - actual.size}). Refusing reconciliation.`);
  }

  for (const entry of manifest) {
    const row = actual.get(entry.id)!;
    if (row.listingId !== entry.listingId || row.paymentProvider !== entry.provider ||
      row.type !== "FEATURED" || row.status !== "SUCCEEDED" || row.refundedAt ||
      row.amount <= 0 || row.currency.toLowerCase() !== "gbp") {
      throw new Error(`Audited Featured payment ${entry.id} no longer matches its reviewed state. Refusing reconciliation.`);
    }
    const evidenceTime = row.lastProviderEventAt ?? row.updatedAt ?? row.createdAt;
    if (row.featuredAppliedAt && row.featuredAppliedAt.getTime() !== evidenceTime.getTime()) {
      throw new Error(`Existing reconciliation marker does not match payment evidence for ${entry.id}. Refusing reconciliation.`);
    }
    if (entry.classification === "synthetic-seed") {
      if (entry.provider !== "DEV" || !row.providerReference?.startsWith("seed:demo:") ||
        !row.providerPaymentId?.startsWith("seed:demo:")) {
        throw new Error(`Synthetic seed provenance mismatch for ${entry.id}. Refusing reconciliation.`);
      }
      continue;
    }

    if (row.listing.status !== "TAKEN_DOWN" || row.listing.featured) {
      throw new Error(`Applied-before-takedown listing state changed for ${entry.id}. Refusing reconciliation.`);
    }
    const approvedAt = row.listing.statusEvents.find((event) => event.action === "APPROVE")?.createdAt;
    const takenDownAt = row.listing.statusEvents.find((event) => event.action === "TAKE_DOWN")?.createdAt;
    const paidAt = row.lastProviderEventAt;
    const lifecycleActions = row.listing.statusEvents.map((event) => event.action).filter(Boolean);
    if (!approvedAt || !takenDownAt || !paidAt ||
      lifecycleActions.join(",") !== "SUBMIT,APPROVE,TAKE_DOWN" ||
      !(approvedAt < paidAt && paidAt < takenDownAt)) {
      throw new Error(`Approval/payment/take-down ordering is not proven for ${entry.id}. Refusing reconciliation.`);
    }
    const expectedEventType = entry.provider === "DEV" ? "sample.succeeded" : "payment.received";
    if (row.lastProviderEventType !== expectedEventType) {
      throw new Error(`Successful Featured payment evidence mismatch for ${entry.id}. Refusing reconciliation.`);
    }
    if (entry.provider === "DEV" && !row.providerReference?.startsWith("sim_")) {
      throw new Error(`Sample payment provenance mismatch for ${entry.id}. Refusing reconciliation.`);
    }
    if (entry.provider === "RIPPLE" && (!row.providerReference || row.providerReference.startsWith("seed:demo:"))) {
      throw new Error(`Ripple payment provenance mismatch for ${entry.id}. Refusing reconciliation.`);
    }
  }
  return manifest.map((entry) => ({ ...entry, payment: actual.get(entry.id)! }));
}

export async function applyReconciliationUpdates(
  tx: Pick<Prisma.TransactionClient, "payment">,
  pending: ReturnType<typeof validateReconciliationSet>,
) {
  let updateCount = 0;
  for (const entry of pending.filter((item) => !item.payment.featuredAppliedAt)) {
    const evidenceTime = entry.payment.lastProviderEventAt ?? entry.payment.updatedAt ?? entry.payment.createdAt;
    const updated = await tx.payment.updateMany({
      where: { id: entry.id, type: "FEATURED", status: "SUCCEEDED", refundedAt: null, featuredAppliedAt: null },
      // Prisma's @updatedAt behavior would otherwise move the evidence timestamp
      // on synthetic rows, making a rerun appear inconsistent.
      data: { featuredAppliedAt: evidenceTime, updatedAt: entry.payment.updatedAt },
    });
    if (updated.count !== 1) throw new Error(`Concurrent change detected for ${entry.id}; transaction rolled back.`);
    updateCount += updated.count;
  }
  const expectedCount = pending.filter((entry) => !entry.payment.featuredAppliedAt).length;
  if (updateCount !== expectedCount) throw new Error("Reconciliation update count mismatch; transaction rolled back.");
  return updateCount;
}

function parseArgs(argv: string[]) {
  let target: Target | null = null;
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--target") {
      const value = argv[index + 1];
      if (target || (value !== "preview" && value !== "production")) {
        throw new Error("Usage: reconcile-legacy-featured-entitlements.ts --target preview|production [--apply]");
      }
      target = value;
      index += 1;
    } else if (arg === "--apply" && !apply) {
      apply = true;
    } else {
      throw new Error("Unknown or repeated reconciliation argument.");
    }
  }
  if (!target) throw new Error("Usage: reconcile-legacy-featured-entitlements.ts --target preview|production [--apply]");
  return { target, apply };
}

function loadTargetEnvironment(target: Target) {
  const file = target === "preview" ? ".env.local" : ".env.production";
  const path = resolve(process.cwd(), file);
  const result = dotenv.config({ path, override: false, quiet: true });
  if (result.error) throw new Error(`Required ${file} target environment is unavailable.`);
  const ref = target === "preview" ? PREVIEW_PROJECT_REF : PRODUCTION_PROJECT_REF;
  if (!isAllowedSupabaseApiUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, ref)) {
    throw new Error(`Refusing ${target} reconciliation: Supabase URL does not match the selected project.`);
  }
  const connectionString = chooseDirectConnectionString([
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
  ], target);
  return connectionString;
}

async function reconcile(prisma: PrismaClient, target: Target, apply: boolean) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('iommarket:legacy-featured-entitlements:v1'))::text AS locked`;
    await tx.$queryRaw`SELECT p.id FROM "Payment" p JOIN "Listing" l ON l.id = p."listingId" WHERE p.type = 'FEATURED' AND p.status = 'SUCCEEDED' AND p."refundedAt" IS NULL FOR UPDATE OF p, l`;
    const rows = await tx.payment.findMany({
      where: { type: "FEATURED", status: "SUCCEEDED", refundedAt: null },
      select: {
        id: true, listingId: true, paymentProvider: true, providerReference: true,
        providerPaymentId: true, type: true, status: true, amount: true, currency: true,
        refundedAt: true, featuredAppliedAt: true, createdAt: true, updatedAt: true,
        lastProviderEventAt: true, lastProviderEventType: true,
        listing: { select: { status: true, featured: true,
          statusEvents: { orderBy: { createdAt: "asc" }, select: { action: true, createdAt: true } },
        } },
      },
    }) as AuditedPayment[];
    const planned = validateReconciliationSet(target, rows);
    const pending = planned.filter((entry) => !entry.payment.featuredAppliedAt);
    if (!apply || pending.length === 0) return { candidateCount: planned.length, updateCount: 0, pendingCount: pending.length };
    const updateCount = await applyReconciliationUpdates(tx, pending);
    return { candidateCount: planned.length, updateCount, pendingCount: pending.length - updateCount };
  }, { isolationLevel: "Serializable" });
}

async function main(argv = process.argv.slice(2)) {
  const { target, apply } = parseArgs(argv);
  const connectionString = loadTargetEnvironment(target);
  const pool = new pg.Pool({ connectionString, ssl: databaseSslOptions(connectionString) });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const result = await reconcile(prisma, target, apply);
    process.stdout.write([
      `target=${target} project=${target === "preview" ? PREVIEW_PROJECT_REF : PRODUCTION_PROJECT_REF}`,
      `auditedCandidates=${result.candidateCount}`,
      `pending=${result.pendingCount}`,
      `updated=${result.updateCount}`,
      apply ? "Apply complete." : "Dry-run complete. No database writes.",
      "",
    ].join("\n"));
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Reconciliation failed."}\n`);
    process.exitCode = 1;
  });
}

export { parseArgs };

import type { MappedArchiveListing } from "../dealer-stock-sync/map-listing";

export const PRODUCTION_AUDIT_VERSION = 1 as const;
export const PRODUCTION_PROJECT_REF = "snlqivvogfqesxpbjiei";
export const PRODUCTION_CONFIRM_DB =
  `db.${PRODUCTION_PROJECT_REF}.supabase.co/postgres`;
export const PRODUCTION_BACKUP_ID =
  "pmr-2026-09-28T20-52-52-749Z-7941e6";

export const PRODUCTION_ACCOUNTS = [
  {
    dealerKey: "athol-garage",
    displayName: "Athol Garage",
    email: "atholgarage@itrader.im.preview",
    regionSlug: "iom-south",
    sourceKind: "founding",
  },
  {
    dealerKey: "mikes-motors",
    displayName: "Mike's Motors",
    email: "mikesmotors@itrader.im.preview",
    regionSlug: "iom-east",
    sourceKind: "founding",
  },
  {
    dealerKey: "rex-motor-company",
    displayName: "Rex Motor Company",
    email: "rexmotorcompany@itrader.im.preview",
    regionSlug: "iom-east",
    sourceKind: "founding",
  },
  {
    dealerKey: "td-car-centre",
    displayName: "TD Car Centre",
    email: "tdcarcentre@itrader.im.preview",
    regionSlug: "iom-east",
    sourceKind: "founding",
  },
  {
    dealerKey: "ocean-motor-village",
    displayName: "Ocean Motor Village",
    email: "oceanmotorvillage@itrader.im.preview",
    regionSlug: "iom-east",
    sourceKind: "ocean",
  },
] as const;

export type ProductionAccount = (typeof PRODUCTION_ACCOUNTS)[number];
export type ProductionSourceKind = ProductionAccount["sourceKind"];

export interface ProductionSourceImage {
  sourceUrl: string;
  localPath: string;
  checksum: string;
  contentType: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
  order: number;
}

export interface ProductionSourceListing {
  identityKey: string;
  managedKey: string;
  sourceUrl: string | null;
  slug: string | null;
  listing: MappedArchiveListing & { regionSlug: string };
  images: ProductionSourceImage[];
  findings: string[];
}

export interface ProductionStatusEventBaseline {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  changedByUserId: string | null;
  source: string;
  action: string | null;
  notes: string | null;
  createdAt: string;
}

export interface ProductionListingBaseline {
  id: string;
  userId: string;
  dealerId: string | null;
  slug: string | null;
  previewPackId: string | null;
  title: string;
  description: string;
  price: number;
  status: string;
  featured: boolean;
  categorySlug: string;
  regionSlug: string;
  expiresAt: string | null;
  trustDeclarationAccepted: boolean;
  trustDeclarationAcceptedAt: string | null;
  photoRevision: number;
  lifecycleRevision: number;
  updatedAt: string;
  attributes: Array<{ id: string; slug: string; value: string }>;
  images: Array<{
    id: string;
    url: string;
    publicId: string;
    provider: string;
    assetId: string | null;
    version: string | null;
    width: number | null;
    height: number | null;
    format: string | null;
    bytes: number | null;
    order: number;
  }>;
  statusEvents: ProductionStatusEventBaseline[];
  revisions: Array<{ id: string; status: string; updatedAt: string }>;
}

export interface ProductionAccountBaseline {
  user: {
    id: string;
    authUserId: string;
    email: string;
    role: string;
    updatedAt: string;
  };
  dealer: {
    id: string;
    userId: string;
    name: string;
    slug: string;
    tier: string;
    verified: boolean;
    isAdminPreview: boolean;
    updatedAt: string;
  };
  listings: ProductionListingBaseline[];
}

export interface ProductionCreateAction {
  kind: "create";
  identityKey: string;
  source: ProductionSourceListing;
}

export interface ProductionUpdateAction {
  kind: "update";
  identityKey: string;
  listingId: string;
  source: ProductionSourceListing;
}

export interface ProductionTakeDownAction {
  kind: "take_down";
  identityKey: string;
  listingId: string;
  fromStatus: string;
}

export type ProductionListingAction =
  | ProductionCreateAction
  | ProductionUpdateAction
  | ProductionTakeDownAction;

export interface ProductionAccountPlan {
  dealerKey: string;
  displayName: string;
  email: string;
  sourceKind: ProductionSourceKind;
  sourceRunId: string;
  sourceChecksum: string;
  applicable: boolean;
  blockers: string[];
  baseline: ProductionAccountBaseline;
  actions: ProductionListingAction[];
}

export interface ProductionAuditPlan {
  version: typeof PRODUCTION_AUDIT_VERSION;
  runId: string;
  createdAt: string;
  target: {
    projectRef: typeof PRODUCTION_PROJECT_REF;
    confirmDb: typeof PRODUCTION_CONFIRM_DB;
  };
  backupId: typeof PRODUCTION_BACKUP_ID;
  foundingSourceRunId: string;
  adminUserId: string;
  actionCount: number;
  accounts: ProductionAccountPlan[];
  fingerprint: string;
}

export interface ProductionUploadedEvidence {
  dealerKey: string;
  identityKey: string;
  listingId: string;
  publicIds: string[];
  assetIds: string[];
  sourceChecksums: string[];
  finalImages: Array<{
    publicId: string;
    assetId: string;
    width: number;
    height: number;
    format: string;
    bytes: number;
  }>;
}

export interface ProductionApplyReport {
  runId: string;
  planFingerprint: string;
  createdAt: string;
  actionsApplied: number;
  listings: ProductionUploadedEvidence[];
}

export interface ProductionVerifyReport {
  runId: string;
  planFingerprint: string;
  createdAt: string;
  ok: boolean;
  accounts: Array<{
    dealerKey: string;
    ok: boolean;
    errors: string[];
    liveManaged: number;
    takenDownManaged: number;
    unmanaged: number;
    imageCount: number;
  }>;
}

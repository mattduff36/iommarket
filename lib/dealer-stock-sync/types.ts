export const UNPUBLISH_AFTER_ABSENCES = 2;

export interface OwnedListingImage {
  publicId: string;
  url: string;
  provider: "CLOUDINARY" | "IMAGEKIT";
  width: number;
  height: number;
  order: number;
  assetId?: string | null;
  version?: string | null;
  imageKitFileId?: string;
  imageKitFilePath?: string;
  cleanupReceiptId?: string;
}

export interface InventoryVehicle {
  sourceIdentityKey: string | null;
  availability: "available" | "reserved" | "sold" | "unknown";
  isPoa: boolean;
  pricePence: number | null;
  mileage: number | null;
  importable: boolean;
  skipReason: string | null;
  title: string | null;
  description: string | null;
  categorySlug: "car" | "van" | "motorbike" | null;
  attributes: Record<string, string> | null;
  ownedImages: OwnedListingImage[];
  remoteImageCount: number;
  sourceImageUrls?: string[];
  sourceUrl?: string | null;
}

export interface SyncListing {
  updatedAt?: string;
  userId?: string;
  title?: string;
  description?: string;
  id: string;
  status: string;
  price: number;
  mileage: number | null;
  featured: boolean;
  expiresAt: string | null;
  soldAt: string | null;
  lifecycleRevision: number;
  photoRevision: number;
  reviewSourceIdentity: string | null;
  slug: string | null;
  previewPackId: string | null;
  openRevision: boolean;
}

export interface SyncIdentity {
  sourceIdentityKey: string;
  listingId: string | null;
  absenceCount: number;
  lastAbsenceRunId: string | null;
  lastSeenRunId: string | null;
  baselinePricePence: number | null;
  baselineMileage: number | null;
}

export interface FieldChange {
  field: "price" | "mileage";
  before: number | null;
  after: number | null;
}

export interface IdentityPatch {
  sourceIdentityKey: string;
  listingId: string | null;
  absenceCount: number;
  lastAbsenceRunId: string | null;
  lastSeenRunId: string | null;
  baselinePricePence: number | null;
  baselineMileage: number | null;
}

interface PlanBase {
  displayTitle?: string;
  sourceIdentityKey: string | null;
  listingId: string | null;
}

export interface CreatePlanAction extends PlanBase {
  kind: "create";
  sourceIdentityKey: string;
  title: string;
  description: string;
  pricePence: number;
  categorySlug: "car" | "van" | "motorbike";
  attributes: Record<string, string>;
  ownedImages: OwnedListingImage[];
  sourceImageUrls?: string[];
  sourceUrl?: string | null;
  changes: FieldChange[];
}

export interface UpdatePlanAction extends PlanBase {
  kind: "update";
  sourceIdentityKey: string;
  listingId: string;
  changes: FieldChange[];
  lifecycleRevision: number;
  photoRevision: number;
  featured: boolean;
}

export interface MissingPlanAction extends PlanBase {
  kind: "missing_once";
  sourceIdentityKey: string;
  absenceCount: number;
}

export interface UnpublishPlanAction extends PlanBase {
  kind: "unpublish";
  sourceIdentityKey: string;
  listingId: string;
  absenceCount: number;
  lifecycleRevision: number;
}

export interface BlockedPlanAction extends PlanBase {
  kind: "blocked";
  reason: string;
  section: "new" | "missing" | "change" | "other";
}

export interface ConflictPlanAction extends PlanBase {
  kind: "conflict";
  sourceIdentityKey: string;
  listingId: string;
  reason: string;
  changes: FieldChange[];
}

export interface UnchangedPlanAction extends PlanBase {
  kind: "unchanged";
  sourceIdentityKey: string;
}

export type PlanAction =
  | CreatePlanAction
  | UpdatePlanAction
  | MissingPlanAction
  | UnpublishPlanAction
  | BlockedPlanAction
  | ConflictPlanAction
  | UnchangedPlanAction;

export interface DealerSyncSubject {
  isAdminPreview: boolean;
  role: "USER" | "DEALER" | "ADMIN";
  disabledAt: Date | string | null;
  deletedAt: Date | string | null;
}

export interface StockSyncPlan {
  actions: PlanAction[];
  patches: IdentityPatch[];
  inventoryCount: number;
}

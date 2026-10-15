import { z } from "zod";
import { isTrustedListingPublicId } from "@/lib/images/cloudinary-url";

export const UNSAVED_DRAFT_VERSION = 1;
export const UNSAVED_DRAFT_MAX_CHARS = 80_000;
export const DRAFT_RESTORED_MESSAGE = "Unsaved draft restored on this device.";
export const DRAFT_SAVED_MESSAGE = "Saved locally on this device.";
export const DRAFT_STORAGE_UNAVAILABLE_MESSAGE =
  "This browser could not save the draft locally. You can keep editing.";
export const DRAFT_CORRUPT_MESSAGE =
  "A saved draft on this device was unreadable and was not restored.";
export const DRAFT_TEXT_QUOTA_MESSAGE =
  "This browser ran out of space to save this draft locally. You can keep editing.";
export const DRAFT_PHOTO_PARTIAL_MESSAGE =
  "Some photos need attention. Retry recovery, or remove and add them again before submitting.";
export const DRAFT_PHOTO_BACKUP_UNAVAILABLE_MESSAGE =
  "Photo backup is unavailable in this browser. Your text draft is still saved.";
export const DRAFT_PHOTO_QUOTA_MESSAGE =
  "This browser ran out of space for photo backup. Your text draft is still saved.";

const KEY_PREFIX = "iommarket.listingDraft.v1";

export type ListingDraftMode = "private" | "dealer";
export type GuidedDraftStep = 1 | 2 | 3 | 4;

export interface DraftCatalog {
  categories: Array<{ id: string; attributeIds: string[] }>;
  regionIds: string[];
}

export interface DraftCatalogueSelection {
  makeMode: "catalogue" | "manual";
  modelMode: "catalogue" | "manual";
  canonicalMake?: string;
  canonicalModel?: string;
  variant?: string;
}

export interface DraftPhoto {
  uploadIntentId: string;
  url: string;
  publicId: string;
  provider: "CLOUDINARY" | "EXTERNAL" | "IMAGEKIT";
  order: number;
  focalX?: number | null;
  focalY?: number | null;
  assetId?: string | null;
  version?: string | null;
  width?: number | null;
  height?: number | null;
  format?: string | null;
  bytes?: number | null;
  imageKitFileId?: string | null;
  imageKitFilePath?: string | null;
  uploadedAt: number;
  listingImageId?: string;
  deliverySource?: "listing" | "revision" | "upload";
}

export interface UnsavedDraftSnapshot {
  categoryId: string;
  title: string;
  description: string;
  price: string;
  regionId: string;
  attributes: Record<string, string>;
  registrationInput: string;
  catalogueSelection: DraftCatalogueSelection;
  photos: Array<Omit<DraftPhoto, "uploadedAt"> & { uploadedAt?: number }>;
  currentStep: GuidedDraftStep;
}

export interface UnsavedListingDraft {
  version: typeof UNSAVED_DRAFT_VERSION;
  savedAt: number;
  userId: string;
  mode: ListingDraftMode;
  categoryId: string;
  title: string;
  description: string;
  price: string;
  regionId: string;
  attributes: Record<string, string>;
  registrationInput: string;
  catalogueSelection: DraftCatalogueSelection;
  photos: DraftPhoto[];
  currentStep: GuidedDraftStep;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DraftScope {
  userId: string;
  mode: ListingDraftMode;
  catalog: DraftCatalog;
}

export function unsavedDraftStorageKey(userId: string, mode: ListingDraftMode, categoryId: string) {
  return `${KEY_PREFIX}.${encodeURIComponent(userId)}.${mode}.${encodeURIComponent(categoryId || "_")}`;
}

export function unsavedDraftPointerKey(userId: string, mode: ListingDraftMode) {
  return `${KEY_PREFIX}.${encodeURIComponent(userId)}.${mode}.last`;
}

export function browserDraftStorage(): KeyValueStorage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const probe = `${KEY_PREFIX}.probe`;
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

export function isServerLinkedDraftPhoto(photo: Pick<DraftPhoto, "listingImageId" | "deliverySource">) {
  return Boolean(photo.listingImageId) || photo.deliverySource === "listing" || photo.deliverySource === "revision";
}

export function snapshotHasDraftContent(snapshot: UnsavedDraftSnapshot) {
  return Boolean(
    snapshot.categoryId ||
      snapshot.title ||
      snapshot.description ||
      snapshot.price ||
      snapshot.regionId ||
      snapshot.registrationInput ||
      snapshot.photos.length > 0 ||
      snapshot.currentStep !== 1 ||
      Object.keys(snapshot.attributes).length > 0,
  );
}

export function formPhotoToDraftPhoto(image: {
  id?: string;
  uploadIntentId: string;
  url: string;
  publicId: string;
  provider: string;
  order: number;
  focalX?: number | null;
  focalY?: number | null;
  assetId?: string | null;
  version?: string | null;
  width?: number | null;
  height?: number | null;
  format?: string | null;
  bytes?: number | null;
  imageKitFileId?: string | null;
  imageKitFilePath?: string | null;
  deliverySource?: DraftPhoto["deliverySource"];
}): UnsavedDraftSnapshot["photos"][number] {
  const provider = image.provider === "IMAGEKIT" || image.provider === "EXTERNAL" ? image.provider : "CLOUDINARY";
  return {
    uploadIntentId: image.uploadIntentId,
    url: image.url,
    publicId: image.publicId,
    provider,
    order: image.order,
    focalX: image.focalX ?? null,
    focalY: image.focalY ?? null,
    assetId: image.assetId ?? null,
    version: image.version ?? null,
    width: image.width ?? null,
    height: image.height ?? null,
    format: image.format ?? null,
    bytes: image.bytes ?? null,
    imageKitFileId: image.imageKitFileId ?? null,
    imageKitFilePath: image.imageKitFilePath ?? null,
    listingImageId: image.id,
    deliverySource: image.deliverySource,
  };
}

export function snapshotFromDraft(draft: UnsavedListingDraft): UnsavedDraftSnapshot {
  return {
    categoryId: draft.categoryId,
    title: draft.title,
    description: draft.description,
    price: draft.price,
    regionId: draft.regionId,
    attributes: draft.attributes,
    registrationInput: draft.registrationInput,
    catalogueSelection: draft.catalogueSelection,
    photos: draft.photos,
    currentStep: draft.currentStep,
  };
}

export function sameDraftContent(draft: UnsavedListingDraft, snapshot: UnsavedDraftSnapshot) {
  const left = snapshotFromDraft(draft);
  return JSON.stringify(normalizeSnapshot(left)) === JSON.stringify(normalizeSnapshot(snapshot));
}

export function parseUnsavedListingDraft(raw: string, scope: DraftScope & { categoryId?: string }) {
  if (raw.length > UNSAVED_DRAFT_MAX_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainRecord(parsed)) return null;
  const result = draftSchema(scope.catalog).safeParse(parsed);
  if (!result.success) return null;
  const draft = result.data;
  if (draft.userId !== scope.userId || draft.mode !== scope.mode) return null;
  if (scope.categoryId !== undefined && draft.categoryId !== scope.categoryId) return null;
  return draft;
}

export function loadActiveUnsavedDraft(storage: KeyValueStorage, scope: DraftScope) {
  try {
    const pointerRaw = storage.getItem(unsavedDraftPointerKey(scope.userId, scope.mode));
    if (!pointerRaw) return { status: "empty" as const };
    const pointer = parsePointer(pointerRaw);
    if (!pointer) {
      storage.removeItem(unsavedDraftPointerKey(scope.userId, scope.mode));
      return { status: "corrupt" as const };
    }
    const key = unsavedDraftStorageKey(scope.userId, scope.mode, pointer.categoryId);
    const raw = storage.getItem(key);
    if (!raw) return { status: "empty" as const };
    const draft = parseUnsavedListingDraft(raw, { ...scope, categoryId: pointer.categoryId });
    if (!draft) {
      storage.removeItem(key);
      return { status: "corrupt" as const };
    }
    return { status: "restored" as const, draft };
  } catch {
    return { status: "unavailable" as const };
  }
}

export function saveUnsavedListingDraft(
  storage: KeyValueStorage,
  input: {
    userId: string;
    mode: ListingDraftMode;
    snapshot: UnsavedDraftSnapshot;
    catalog: DraftCatalog;
    uploadedAtByIntent: Record<string, number>;
    now?: number;
  },
) {
  const now = input.now ?? Date.now();
  const uploadedAtByIntent = { ...input.uploadedAtByIntent };
  const photos: DraftPhoto[] = input.snapshot.photos.map((photo) => {
    const uploadedAt = uploadedAtByIntent[photo.uploadIntentId] ?? photo.uploadedAt ?? now;
    uploadedAtByIntent[photo.uploadIntentId] = uploadedAt;
    return { ...photo, uploadedAt };
  });
  const candidate = {
    version: UNSAVED_DRAFT_VERSION,
    savedAt: now,
    userId: input.userId,
    mode: input.mode,
    categoryId: input.snapshot.categoryId,
    title: input.snapshot.title,
    description: input.snapshot.description,
    price: input.snapshot.price,
    regionId: input.snapshot.regionId,
    attributes: input.snapshot.attributes,
    registrationInput: input.snapshot.registrationInput,
    catalogueSelection: input.snapshot.catalogueSelection,
    photos,
    currentStep: input.snapshot.currentStep,
  };
  const raw = JSON.stringify(candidate);
  const draft = parseUnsavedListingDraft(raw, {
    userId: input.userId,
    mode: input.mode,
    categoryId: input.snapshot.categoryId,
    catalog: input.catalog,
  });
  if (!draft) return { ok: false as const, message: DRAFT_STORAGE_UNAVAILABLE_MESSAGE };
  try {
    storage.setItem(unsavedDraftStorageKey(input.userId, input.mode, draft.categoryId), raw);
    storage.setItem(
      unsavedDraftPointerKey(input.userId, input.mode),
      JSON.stringify({ version: UNSAVED_DRAFT_VERSION, categoryId: draft.categoryId }),
    );
  } catch (error) {
    return { ok: false as const, message: storageFailureMessage(error) };
  }
  return { ok: true as const, draft, uploadedAtByIntent };
}

export function clearUnsavedListingDraft(
  storage: KeyValueStorage,
  scope: { userId: string; mode: ListingDraftMode; categoryId: string },
) {
  storage.removeItem(unsavedDraftStorageKey(scope.userId, scope.mode, scope.categoryId));
  const pointerKey = unsavedDraftPointerKey(scope.userId, scope.mode);
  const pointer = parsePointer(storage.getItem(pointerKey) ?? "");
  if (!pointer || pointer.categoryId === scope.categoryId) storage.removeItem(pointerKey);
}

export function storageFailureMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
    return DRAFT_TEXT_QUOTA_MESSAGE;
  }
  return DRAFT_STORAGE_UNAVAILABLE_MESSAGE;
}

function parsePointer(raw: string) {
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = z
      .object({ version: z.literal(UNSAVED_DRAFT_VERSION), categoryId: z.string().max(100) })
      .strict()
      .safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function normalizeSnapshot(snapshot: UnsavedDraftSnapshot) {
  return {
    ...snapshot,
    attributes: Object.fromEntries(Object.entries(snapshot.attributes).sort(([left], [right]) => left.localeCompare(right))),
    photos: snapshot.photos.map((photo) => ({ ...photo, uploadedAt: photo.uploadedAt ?? 0 })),
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return !["__proto__", "constructor", "prototype"].some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function hasDisallowedControl(value: string, multiline: boolean) {
  return multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value) : /[\u0000-\u001F]/.test(value);
}

function isSafePhotoUrl(url: string) {
  if (url === "") return true;
  if (url.length > 500 || /[<>\s]/.test(url)) return false;
  if (/^imagekit-private:\/iommarket-media\/(production|staging|local)\/listings\/[A-Za-z0-9_-]{1,80}\/[A-Za-z0-9_-]{1,80}\/photo\.(jpg|png|webp)$/.test(url)) return true;
  // Private uploads are delivered through the same-origin media endpoint.
  if (url.startsWith("/api/media/listing-photo?")) {
    const parsed = new URL(url, "https://draft.invalid");
    return parsed.origin === "https://draft.invalid" &&
      parsed.pathname === "/api/media/listing-photo" &&
      /^[A-Za-z0-9_-]+$/.test(parsed.searchParams.get("imageId") ?? "");
  }
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function isSafePublicId(publicId: string, provider: DraftPhoto["provider"]) {
  if (publicId.length > 200 || publicId.includes("..") || !/^[a-zA-Z0-9/_\-.]+$/.test(publicId)) return false;
  if (provider === "CLOUDINARY") return isTrustedListingPublicId(publicId);
  return true;
}

function draftSchema(catalog: DraftCatalog) {
  const categoryIds = new Set(catalog.categories.map((category) => category.id));
  const regionIds = new Set(catalog.regionIds);
  const attributeIds = new Map(catalog.categories.map((category) => [category.id, new Set(category.attributeIds)]));
  const photoSchema = z
    .object({
      uploadIntentId: z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/),
      url: z.string().max(500),
      publicId: z.string().min(1).max(200),
      provider: z.enum(["CLOUDINARY", "EXTERNAL", "IMAGEKIT"]),
      order: z.number().int().min(0).max(19),
      focalX: z.number().min(0).max(1).nullable().optional(),
      focalY: z.number().min(0).max(1).nullable().optional(),
      assetId: z.string().max(120).nullable().optional(),
      version: z.string().max(40).nullable().optional(),
      width: z.number().int().positive().max(20_000).nullable().optional(),
      height: z.number().int().positive().max(20_000).nullable().optional(),
      format: z.string().max(10).nullable().optional(),
      bytes: z.number().int().nonnegative().max(20_000_000).nullable().optional(),
      imageKitFileId: z.string().max(120).nullable().optional(),
      imageKitFilePath: z.string().max(300).nullable().optional(),
      uploadedAt: z.number().int().positive(),
      listingImageId: z.string().min(1).max(80).optional(),
      deliverySource: z.enum(["listing", "revision", "upload"]).optional(),
    })
    .strict();

  return z
    .object({
      version: z.literal(UNSAVED_DRAFT_VERSION),
      savedAt: z.number().int().positive(),
      userId: z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/),
      mode: z.enum(["private", "dealer"]),
      categoryId: z.string().max(100),
      title: z.string().max(120),
      description: z.string().max(5000),
      price: z.string().regex(/^(?:\d{0,8}(?:\.\d{0,2})?)?$/),
      regionId: z.string().max(100),
      attributes: z.record(z.string(), z.string()),
      registrationInput: z.string().max(20).regex(/^[A-Za-z0-9 -]*$/),
      catalogueSelection: z
        .object({
          makeMode: z.enum(["catalogue", "manual"]),
          modelMode: z.enum(["catalogue", "manual"]),
          canonicalMake: z.string().max(80).optional(),
          canonicalModel: z.string().max(80).optional(),
          variant: z.string().max(60).optional(),
        })
        .strict(),
      photos: z.array(photoSchema).max(20),
      currentStep: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    })
    .strict()
    .superRefine((draft, context) => {
      if (hasDisallowedControl(draft.title, false) || hasDisallowedControl(draft.description, true)) {
        context.addIssue({ code: "custom", message: "text" });
      }
      if (draft.categoryId && !categoryIds.has(draft.categoryId)) {
        context.addIssue({ code: "custom", message: "category" });
      }
      if (draft.regionId && !regionIds.has(draft.regionId)) {
        context.addIssue({ code: "custom", message: "region" });
      }
      const allowedAttributes = attributeIds.get(draft.categoryId) ?? new Set<string>();
      if (!draft.categoryId && Object.keys(draft.attributes).length > 0) {
        context.addIssue({ code: "custom", message: "attributes" });
      }
      for (const [attributeId, value] of Object.entries(draft.attributes)) {
        if (
          attributeId.length > 100 ||
          value.length > 1000 ||
          !allowedAttributes.has(attributeId) ||
          hasDisallowedControl(value, true)
        ) {
          context.addIssue({ code: "custom", message: "attribute" });
        }
      }
      const intents = new Set<string>();
      for (const photo of draft.photos) {
        if (intents.has(photo.uploadIntentId)) context.addIssue({ code: "custom", message: "photo" });
        intents.add(photo.uploadIntentId);
        if (!isSafePhotoUrl(photo.url) || !isSafePublicId(photo.publicId, photo.provider)) {
          context.addIssue({ code: "custom", message: "photo-url" });
        }
      }
    });
}

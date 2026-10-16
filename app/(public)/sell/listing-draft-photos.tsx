"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { buildCanonicalListingImageUrl } from "@/lib/images/cloudinary-url";
import { uploadListingImageFile } from "@/lib/images/client-upload";
import type { ListingPhotoSource } from "@/lib/images/photo";
import {
  DRAFT_CORRUPT_MESSAGE,
  DRAFT_PHOTO_BACKUP_UNAVAILABLE_MESSAGE,
  DRAFT_PHOTO_PARTIAL_MESSAGE,
  DRAFT_PHOTO_QUOTA_MESSAGE,
  DRAFT_RESTORED_MESSAGE,
  DRAFT_SAVED_MESSAGE,
  DRAFT_STORAGE_UNAVAILABLE_MESSAGE,
  browserDraftStorage,
  clearUnsavedListingDraft,
  isServerLinkedDraftPhoto,
  loadActiveUnsavedDraft,
  parseUnsavedListingDraft,
  sameDraftContent,
  saveUnsavedListingDraft,
  snapshotFromDraft,
  snapshotHasDraftContent,
  unsavedDraftStorageKey,
  type DraftCatalog,
  type DraftPhoto,
  type KeyValueStorage,
  type ListingDraftMode,
  type UnsavedDraftSnapshot,
  type UnsavedListingDraft,
} from "./listing-unsaved-draft";

export const PHOTO_REFRESH_AFTER_MS = 55 * 60 * 1000;
const PHOTO_DB_NAME = "iommarket-listing-draft-photos";
const PHOTO_STORE = "files";

export interface CachedListingPhoto {
  file: File;
  savedAt: number;
}

export interface PhotoBlobStore {
  put(key: string, value: CachedListingPhoto): Promise<void>;
  get(key: string): Promise<CachedListingPhoto | undefined>;
  deletePrefix(prefix: string): Promise<void>;
}

type UploadFile = (file: File) => Promise<ListingPhotoSource>;

const ListingDraftPhotoBackupContext = createContext<((intentId: string, file: File) => void) | null>(null);

export function listingPhotoCacheKey(userId: string, mode: ListingDraftMode, categoryId: string, intentId: string) {
  return [userId, mode, categoryId || "_", intentId].join("\u0000");
}

export function listingPhotoCachePrefix(userId: string, mode: ListingDraftMode, categoryId: string) {
  return `${[userId, mode, categoryId || "_"].join("\u0000")}\u0000`;
}

export function photoNeedsRefresh(uploadedAt: number, now = Date.now()) {
  return now - uploadedAt > PHOTO_REFRESH_AFTER_MS;
}

export function createMemoryPhotoBlobStore(): PhotoBlobStore {
  const records = new Map<string, CachedListingPhoto>();
  return {
    async put(key, value) {
      records.set(key, value);
    },
    async get(key) {
      return records.get(key);
    },
    async deletePrefix(prefix) {
      for (const key of records.keys()) {
        if (key.startsWith(prefix)) records.delete(key);
      }
    },
  };
}

export function useListingDraftPhotoBackup() {
  return useContext(ListingDraftPhotoBackupContext);
}

export function ListingDraftPhotoProvider({
  userId,
  mode,
  categoryId,
  enabled,
  onFailure,
  photoStore,
  children,
}: {
  userId: string;
  mode: ListingDraftMode;
  categoryId: string;
  enabled: boolean;
  onFailure?: (message: string) => void;
  photoStore?: PhotoBlobStore;
  children: ReactNode;
}) {
  const onFailureRef = useRef(onFailure);
  onFailureRef.current = onFailure;
  const backup = useCallback(
    (intentId: string, file: File) => {
      if (!enabled || !userId) return;
      void backupListingPhotoFile(
        { userId, mode, categoryId, intentId, file, store: photoStore },
      ).then((result) => {
        if (!result.ok) onFailureRef.current?.(result.message);
      });
    },
    [categoryId, enabled, mode, photoStore, userId],
  );
  return <ListingDraftPhotoBackupContext.Provider value={backup}>{children}</ListingDraftPhotoBackupContext.Provider>;
}

export async function backupListingPhotoFile(input: {
  userId: string;
  mode: ListingDraftMode;
  categoryId: string;
  intentId: string;
  file: File;
  store?: PhotoBlobStore;
  now?: number;
}) {
  try {
    const store = input.store ?? idbPhotoStore();
    await store.put(listingPhotoCacheKey(input.userId, input.mode, input.categoryId, input.intentId), {
      file: input.file,
      savedAt: input.now ?? Date.now(),
    });
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, message: photoStorageMessage(error) };
  }
}

export async function clearCachedListingPhotos(input: {
  userId: string;
  mode: ListingDraftMode;
  categoryId: string;
  store?: PhotoBlobStore;
}) {
  const store = input.store ?? idbPhotoStore();
  await store.deletePrefix(listingPhotoCachePrefix(input.userId, input.mode, input.categoryId));
}

export async function copyCachedListingPhotos(input: {
  userId: string;
  mode: ListingDraftMode;
  fromCategoryId: string;
  toCategoryId: string;
  intentIds: string[];
  store?: PhotoBlobStore;
}) {
  if (input.fromCategoryId === input.toCategoryId) return { ok: true as const };
  try {
    const store = input.store ?? idbPhotoStore();
    for (const intentId of input.intentIds) {
      const cached = await store.get(listingPhotoCacheKey(input.userId, input.mode, input.fromCategoryId, intentId));
      if (!cached) continue;
      await store.put(listingPhotoCacheKey(input.userId, input.mode, input.toCategoryId, intentId), cached);
    }
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, message: photoStorageMessage(error) };
  }
}

export async function recoverDraftPhotos(input: {
  photos: DraftPhoto[];
  userId: string;
  mode: ListingDraftMode;
  categoryId: string;
  store?: PhotoBlobStore;
  uploadFile?: UploadFile;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const uploadFile = input.uploadFile ?? uploadListingImageFile;
  const store = input.store ?? idbPhotoStore();
  const photos: DraftPhoto[] = [];
  const failedIds: string[] = [];
  const retainFailed = (photo: DraftPhoto) => { failedIds.push(photo.uploadIntentId); photos.push(photo); };
  let backupWarning: string | null = null;
  for (const photo of input.photos) {
    if (isServerLinkedDraftPhoto(photo) || !photoNeedsRefresh(photo.uploadedAt, now)) {
      photos.push(photo);
      continue;
    }
    try {
      const cached = await store.get(listingPhotoCacheKey(input.userId, input.mode, input.categoryId, photo.uploadIntentId));
      if (!cached?.file) {
        retainFailed(photo);
        continue;
      }
      const uploaded = await uploadFile(cached.file);
      if (!uploaded.uploadIntentId) {
        retainFailed(photo);
        continue;
      }
      photos.push(refreshedPhoto(photo, uploaded, now));
      try {
        await store.put(listingPhotoCacheKey(input.userId, input.mode, input.categoryId, uploaded.uploadIntentId), cached);
      } catch (error) { backupWarning = photoStorageMessage(error); }
    } catch {
      retainFailed(photo);
    }
  }
  return {
    photos,
    failedIds,
    warning: failedIds.length > 0 ? DRAFT_PHOTO_PARTIAL_MESSAGE : backupWarning,
  };
}

export function useUnsavedListingDraft(options: {
  enabled: boolean;
  userId: string;
  mode: ListingDraftMode;
  catalog: DraftCatalog;
  snapshot: UnsavedDraftSnapshot;
  applyDraft: (draft: UnsavedListingDraft) => void;
  resetFields: () => void;
  storage?: KeyValueStorage | null;
  photoStore?: PhotoBlobStore;
  uploadFile?: UploadFile;
  now?: () => number;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [failedPhotoIds, setFailedPhotoIds] = useState<string[]>([]);
  const [gate, setGate] = useState(0);
  const [recoveryVersion, setRecoveryVersion] = useState(0);
  const snapshotRef = useRef(options.snapshot);
  const previousSnapshot = useRef<UnsavedDraftSnapshot | null>(null);
  const uploadedAtRef = useRef<Record<string, number>>({});
  const applyRef = useRef(options.applyDraft);
  const resetRef = useRef(options.resetFields);
  const sealed = useRef(false);
  const suppress = useRef(false);
  const restoredEcho = useRef(false);
  const pendingRecovery = useRef<UnsavedListingDraft | null>(null);
  const storageRef = useRef<KeyValueStorage | null | undefined>(undefined);
  if (storageRef.current === undefined) {
    storageRef.current = !options.enabled
      ? null
      : options.storage === undefined
        ? browserDraftStorage()
        : options.storage;
  }
  const storage = storageRef.current;
  snapshotRef.current = options.snapshot;
  applyRef.current = options.applyDraft;
  resetRef.current = options.resetFields;
  const now = options.now ?? Date.now;

  useLayoutEffect(() => {
    if (!options.enabled || !options.userId) {
      setGate(1);
      return;
    }
    if (!storage) {
      setWarning(DRAFT_STORAGE_UNAVAILABLE_MESSAGE);
      setGate(1);
      return;
    }
    const loaded = loadActiveUnsavedDraft(storage, {
      userId: options.userId,
      mode: options.mode,
      catalog: options.catalog,
    });
    if (loaded.status === "corrupt" || loaded.status === "unavailable") {
      setWarning(loaded.status === "corrupt" ? DRAFT_CORRUPT_MESSAGE : DRAFT_STORAGE_UNAVAILABLE_MESSAGE);
    }
    if (loaded.status === "restored") {
      for (const photo of loaded.draft.photos) uploadedAtRef.current[photo.uploadIntentId] = photo.uploadedAt;
      const expired = loaded.draft.photos.some(
        (photo) => !isServerLinkedDraftPhoto(photo) && photoNeedsRefresh(photo.uploadedAt, now()),
      );
      if (expired) {
        pendingRecovery.current = loaded.draft;
        setRecovering(true);
      }
      restoredEcho.current = true;
      applyRef.current(loaded.draft);
      setMessage(DRAFT_RESTORED_MESSAGE);
    }
    setGate(1);
    // Restore once before later saves. Catalog and storage are the mount scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const draft = pendingRecovery.current;
    if (!draft || !options.enabled || gate !== 1) return;
    let cancelled = false;
    void recoverDraftPhotos({
      photos: draft.photos,
      userId: options.userId,
      mode: options.mode,
      categoryId: draft.categoryId,
      store: options.photoStore,
      uploadFile: options.uploadFile,
      now: now(),
    })
      .then((result) => {
        if (cancelled || sealed.current || snapshotRef.current.categoryId !== draft.categoryId) return;
        pendingRecovery.current = null;
        const next = { ...draft, ...snapshotRef.current, photos: result.photos };
        for (const photo of result.photos) uploadedAtRef.current[photo.uploadIntentId] = photo.uploadedAt;
        applyRef.current(next);
        setFailedPhotoIds(result.failedIds);
        setWarning(result.warning);
      })
      .finally(() => {
        if (!cancelled) setRecovering(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gate, recoveryVersion, now, options.enabled, options.mode, options.photoStore, options.uploadFile, options.userId]);

  useEffect(() => {
    if (!options.enabled || gate !== 1 || sealed.current || !storage) return;
    if (suppress.current) {
      suppress.current = false;
      previousSnapshot.current = snapshotRef.current;
      return;
    }
    const snapshot = options.snapshot;
    const previous = previousSnapshot.current;
    if (previous && previous.categoryId !== snapshot.categoryId) {
      if (snapshotHasDraftContent(previous)) {
        const saved = saveUnsavedListingDraft(storage, {
          userId: options.userId,
          mode: options.mode,
          snapshot: previous,
          catalog: options.catalog,
          uploadedAtByIntent: uploadedAtRef.current,
          now: now(),
        });
        if (saved.ok) uploadedAtRef.current = saved.uploadedAtByIntent;
      }
      const stored = readCategoryDraft(storage, options, snapshot.categoryId);
      if (stored && !sameDraftContent(stored, snapshot)) {
        for (const photo of stored.photos) uploadedAtRef.current[photo.uploadIntentId] = photo.uploadedAt;
        previousSnapshot.current = snapshotFromDraft(stored);
        if (stored.photos.some((photo) => !isServerLinkedDraftPhoto(photo) && photoNeedsRefresh(photo.uploadedAt, now()))) {
          pendingRecovery.current = stored;
          setRecovering(true);
          setRecoveryVersion((value) => value + 1);
        }
        applyRef.current(stored);
        return;
      }
      const intentIds = snapshot.photos.filter((photo) => !isServerLinkedDraftPhoto(photo)).map((photo) => photo.uploadIntentId);
      void copyCachedListingPhotos({
        userId: options.userId,
        mode: options.mode,
        fromCategoryId: previous.categoryId,
        toCategoryId: snapshot.categoryId,
        intentIds,
        store: options.photoStore,
      }).then((result) => {
        if (!result.ok) setWarning(result.message);
      });
    }
    if (!snapshotHasDraftContent(snapshot)) {
      previousSnapshot.current = snapshot;
      return;
    }
    if (restoredEcho.current) {
      restoredEcho.current = false;
      const saved = saveUnsavedListingDraft(storage, {
        userId: options.userId,
        mode: options.mode,
        snapshot,
        catalog: options.catalog,
        uploadedAtByIntent: uploadedAtRef.current,
        now: now(),
      });
      if (saved.ok) uploadedAtRef.current = saved.uploadedAtByIntent;
      else setWarning(saved.message);
      previousSnapshot.current = snapshot;
      return;
    }
    const saved = saveUnsavedListingDraft(storage, {
      userId: options.userId,
      mode: options.mode,
      snapshot,
      catalog: options.catalog,
      uploadedAtByIntent: uploadedAtRef.current,
      now: now(),
    });
    if (!saved.ok) {
      setWarning(saved.message);
      return;
    }
    uploadedAtRef.current = saved.uploadedAtByIntent;
    previousSnapshot.current = snapshot;
    setMessage(DRAFT_SAVED_MESSAGE);
  }, [gate, options.catalog, options.enabled, options.mode, options.snapshot, options.userId, storage, now]);

  useEffect(() => {
    if (!options.enabled) return;
    const persistNow = () => {
      if (sealed.current || suppress.current || gate !== 1 || !storage) return;
      const snapshot = snapshotRef.current;
      if (!snapshotHasDraftContent(snapshot)) return;
      const saved = saveUnsavedListingDraft(storage, {
        userId: options.userId,
        mode: options.mode,
        snapshot,
        catalog: options.catalog,
        uploadedAtByIntent: uploadedAtRef.current,
        now: now(),
      });
      if (saved.ok) uploadedAtRef.current = saved.uploadedAtByIntent;
    };
    window.addEventListener("pagehide", persistNow);
    return () => {
      persistNow();
      window.removeEventListener("pagehide", persistNow);
    };
  }, [gate, options.catalog, options.enabled, options.mode, options.userId, storage, now]);

  const commitClear = useCallback(() => {
    if (!options.enabled) return;
    sealed.current = true;
    const snapshot = snapshotRef.current;
    if (storage) {
      try {
        clearUnsavedListingDraft(storage, {
          userId: options.userId,
          mode: options.mode,
          categoryId: snapshot.categoryId,
        });
      } catch {
        setWarning(DRAFT_STORAGE_UNAVAILABLE_MESSAGE);
      }
    }
    void clearCachedListingPhotos({
      userId: options.userId,
      mode: options.mode,
      categoryId: snapshot.categoryId,
      store: options.photoStore,
    }).catch((error) => {
      setWarning(photoStorageMessage(error));
    });
  }, [options.enabled, options.mode, options.photoStore, options.userId, storage]);

  const discard = useCallback(() => {
    if (!options.enabled) return;
    const snapshot = snapshotRef.current;
    sealed.current = false;
    suppress.current = true;
    if (storage) {
      try {
        clearUnsavedListingDraft(storage, {
          userId: options.userId,
          mode: options.mode,
          categoryId: snapshot.categoryId,
        });
      } catch {
        setWarning(DRAFT_STORAGE_UNAVAILABLE_MESSAGE);
      }
    }
    void clearCachedListingPhotos({
      userId: options.userId,
      mode: options.mode,
      categoryId: snapshot.categoryId,
      store: options.photoStore,
    }).catch((error) => {
      setWarning(photoStorageMessage(error));
    });
    previousSnapshot.current = null;
    setMessage(null);
    setWarning(null);
    resetRef.current();
  }, [options.enabled, options.mode, options.photoStore, options.userId, storage]);

  const photosNeedAttention = options.snapshot.photos.some((photo) => failedPhotoIds.includes(photo.uploadIntentId));
  const retryPhotoRecovery = () => {
    const snapshot = snapshotRef.current;
    pendingRecovery.current = {
      version: 1, savedAt: now(), userId: options.userId, mode: options.mode, ...snapshot,
      photos: snapshot.photos.map((photo) => ({ ...photo, uploadedAt: uploadedAtRef.current[photo.uploadIntentId] ?? photo.uploadedAt ?? now() })),
    };
    setRecovering(true);
    setRecoveryVersion((value) => value + 1);
  };
  return {
    message,
    warning,
    recovering,
    photosNeedAttention,
    retryPhotoRecovery,
    canDiscard: options.enabled && gate === 1 && Boolean(message),
    discard,
    commitClear,
    reportStorageFailure: setWarning,
  };
}

function readCategoryDraft(
  storage: KeyValueStorage,
  options: { userId: string; mode: ListingDraftMode; catalog: DraftCatalog },
  categoryId: string,
) {
  try {
    const raw = storage.getItem(unsavedDraftStorageKey(options.userId, options.mode, categoryId));
    return raw ? parseUnsavedListingDraft(raw, { ...options, categoryId }) : null;
  } catch { return null; }
}

function refreshedPhoto(photo: DraftPhoto, uploaded: ListingPhotoSource, now: number): DraftPhoto {
  const provider: DraftPhoto["provider"] =
    uploaded.provider === "IMAGEKIT" || uploaded.provider === "EXTERNAL" ? uploaded.provider : "CLOUDINARY";
  const next = {
    ...photo,
    uploadIntentId: uploaded.uploadIntentId ?? photo.uploadIntentId,
    url: uploaded.url,
    publicId: uploaded.publicId,
    provider,
    assetId: uploaded.assetId ?? null,
    version: uploaded.version ?? null,
    width: uploaded.width ?? null,
    height: uploaded.height ?? null,
    format: uploaded.format ?? null,
    bytes: uploaded.bytes ?? null,
    imageKitFileId: uploaded.imageKitFileId ?? null,
    imageKitFilePath: uploaded.imageKitFilePath ?? null,
    uploadedAt: now,
    deliverySource: "upload" as const,
    listingImageId: undefined,
    order: photo.order,
    focalX: photo.focalX ?? null,
    focalY: photo.focalY ?? null,
  };
  return {
    ...next,
    url: buildCanonicalListingImageUrl(next) || uploaded.url,
  };
}

function photoStorageMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") return DRAFT_PHOTO_QUOTA_MESSAGE;
  if (name === "SecurityError" || typeof indexedDB === "undefined") return DRAFT_PHOTO_BACKUP_UNAVAILABLE_MESSAGE;
  return DRAFT_PHOTO_BACKUP_UNAVAILABLE_MESSAGE;
}

function idbPhotoStore(): PhotoBlobStore {
  return {
    async put(key, value) {
      const db = await openPhotoDb();
      await runStoreRequest(db, "readwrite", (store) => store.put(value, key));
    },
    async get(key) {
      const db = await openPhotoDb();
      return runStoreRequest(db, "readonly", (store) => store.get(key));
    },
    async deletePrefix(prefix) {
      const db = await openPhotoDb();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(PHOTO_STORE, "readwrite");
        const store = transaction.objectStore(PHOTO_STORE);
        const request = store.openCursor();
        request.onerror = () => reject(request.error ?? new Error("Could not read photo backup."));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          if (String(cursor.key).startsWith(prefix)) cursor.delete();
          cursor.continue();
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("Could not clear photo backup."));
      });
    },
  };
}

function openPhotoDb() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new DOMException("IndexedDB is unavailable.", "SecurityError"));
  }
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(PHOTO_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PHOTO_STORE)) db.createObjectStore(PHOTO_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new DOMException("IndexedDB is unavailable.", "SecurityError"));
  });
}

function runStoreRequest<T>(db: IDBDatabase, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(PHOTO_STORE, mode);
    const request = action(transaction.objectStore(PHOTO_STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Photo backup failed."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Photo backup failed."));
  });
}

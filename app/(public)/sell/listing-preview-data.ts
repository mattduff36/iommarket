import {
  parseUnsavedListingDraft,
  saveUnsavedListingDraft,
  type DraftScope,
  type KeyValueStorage,
  type UnsavedDraftSnapshot,
} from "./listing-unsaved-draft";

export function listingPreviewKey(userId: string, mode: string) {
  return `iommarket.listingPreview.v1.${encodeURIComponent(userId)}.${mode}`;
}

export function saveListingPreview(storage: KeyValueStorage, scope: DraftScope, snapshot: UnsavedDraftSnapshot) {
  const temporary = new Map<string, string>();
  const result = saveUnsavedListingDraft({
    getItem: (key) => temporary.get(key) ?? null,
    setItem: (key, value) => { temporary.set(key, value); },
    removeItem: (key) => { temporary.delete(key); },
  }, { ...scope, snapshot, uploadedAtByIntent: {} });
  if (!result.ok) throw new Error("Your preview could not be prepared. Check your listing details and try again.");
  storage.setItem(listingPreviewKey(scope.userId, scope.mode), JSON.stringify(result.draft));
}

export function loadListingPreview(storage: KeyValueStorage, scope: DraftScope) {
  try {
    const raw = storage.getItem(listingPreviewKey(scope.userId, scope.mode));
    if (!raw) return null;
    const draft = parseUnsavedListingDraft(raw, scope);
    return draft && Date.now() - draft.savedAt < 86_400_000 ? draft : null;
  } catch { return null; }
}

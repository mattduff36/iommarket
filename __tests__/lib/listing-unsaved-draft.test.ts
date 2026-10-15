import { describe, expect, it } from "vitest";
import {
  DRAFT_TEXT_QUOTA_MESSAGE,
  UNSAVED_DRAFT_MAX_CHARS,
  clearUnsavedListingDraft,
  loadActiveUnsavedDraft,
  parseUnsavedListingDraft,
  saveUnsavedListingDraft,
  unsavedDraftPointerKey,
  unsavedDraftStorageKey,
  type DraftCatalog,
  type KeyValueStorage,
  type UnsavedDraftSnapshot,
} from "@/app/(public)/sell/listing-unsaved-draft";

const catalog: DraftCatalog = {
  categories: [
    { id: "cars", attributeIds: ["make", "model"] },
    { id: "vans", attributeIds: ["body"] },
  ],
  regionIds: ["region_north"],
};

function memoryStorage(): KeyValueStorage & { dump(): Map<string, string> } {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => {
      values.delete(key);
    },
    dump: () => values,
  };
}

function snapshot(overrides: Partial<UnsavedDraftSnapshot> = {}): UnsavedDraftSnapshot {
  return {
    categoryId: "cars",
    title: "Blue bike",
    description: "A <b>blue</b> bike for sale",
    price: "12.",
    regionId: "region_north",
    attributes: { make: "Ford" },
    registrationInput: "MAN 1",
    catalogueSelection: { makeMode: "manual", modelMode: "manual" },
    photos: [
      {
        uploadIntentId: "intent_1",
        url: "https://res.cloudinary.com/demo/image/private/v1/iommarket/listings/staging/user/intent_1.jpg",
        publicId: "iommarket/listings/staging/user/intent_1",
        provider: "CLOUDINARY",
        order: 1,
        focalX: 0.25,
        focalY: 0.5,
        uploadedAt: 1_700_000_000_000,
      },
    ],
    currentStep: 2,
    ...overrides,
  };
}

function save(storage: KeyValueStorage, userId: string, mode: "private" | "dealer", body = snapshot()) {
  return saveUnsavedListingDraft(storage, {
    userId,
    mode,
    snapshot: body,
    catalog,
    uploadedAtByIntent: {},
    now: 1_700_000_100_000,
  });
}

describe("unsaved listing drafts", () => {
  it("restores only the matching user, mode, and category", () => {
    const storage = memoryStorage();
    expect(save(storage, "user_a", "private").ok).toBe(true);
    expect(save(storage, "user_b", "private", snapshot({ title: "Other seller" })).ok).toBe(true);
    expect(save(storage, "user_a", "dealer", snapshot({ title: "Dealer van", categoryId: "vans", attributes: { body: "Panel" } })).ok).toBe(true);

    const restored = loadActiveUnsavedDraft(storage, { userId: "user_a", mode: "private", catalog });
    expect(restored.status).toBe("restored");
    if (restored.status !== "restored") return;
    expect(restored.draft.title).toBe("Blue bike");
    expect(restored.draft.attributes).toEqual({ make: "Ford" });
    expect(restored.draft.description).toBe("A <b>blue</b> bike for sale");
    expect(JSON.stringify(restored.draft)).not.toMatch(/password|token|base64|data:/i);

    const dealer = loadActiveUnsavedDraft(storage, { userId: "user_a", mode: "dealer", catalog });
    expect(dealer.status).toBe("restored");
    if (dealer.status === "restored") expect(dealer.draft.attributes).toEqual({ body: "Panel" });
  });

  it("keeps the original photo time when the text draft is saved again", () => {
    const storage = memoryStorage();
    const first = save(storage, "user_a", "private");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = saveUnsavedListingDraft(storage, {
      userId: "user_a",
      mode: "private",
      snapshot: snapshot({ title: "Blue bike updated" }),
      catalog,
      uploadedAtByIntent: first.uploadedAtByIntent,
      now: first.draft.savedAt + 60_000,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.draft.photos[0]?.uploadedAt).toBe(1_700_000_000_000);
  });

  it("rejects corrupt, foreign, oversized, and incompatible drafts", () => {
    const storage = memoryStorage();
    const key = unsavedDraftStorageKey("user_a", "private", "cars");
    storage.setItem(unsavedDraftPointerKey("user_a", "private"), JSON.stringify({ version: 1, categoryId: "cars" }));
    storage.setItem(key, "{");
    expect(loadActiveUnsavedDraft(storage, { userId: "user_a", mode: "private", catalog }).status).toBe("corrupt");
    expect(storage.getItem(key)).toBeNull();

    const foreign = save(memoryStorage(), "user_b", "private");
    expect(foreign.ok).toBe(true);
    if (!foreign.ok) return;
    const foreignRaw = JSON.stringify(foreign.draft);
    storage.setItem(unsavedDraftPointerKey("user_a", "private"), JSON.stringify({ version: 1, categoryId: "cars" }));
    storage.setItem(key, foreignRaw);
    expect(parseUnsavedListingDraft(foreignRaw, { userId: "user_a", mode: "private", categoryId: "cars", catalog })).toBeNull();

    expect(parseUnsavedListingDraft("x".repeat(UNSAVED_DRAFT_MAX_CHARS + 1), { userId: "user_a", mode: "private", catalog })).toBeNull();
    const versioned = { ...foreign.draft, version: 2, userId: "user_a" };
    expect(parseUnsavedListingDraft(JSON.stringify(versioned), { userId: "user_a", mode: "private", catalog })).toBeNull();
    const scriptUrl = {
      ...foreign.draft,
      userId: "user_a",
      photos: [{ ...foreign.draft.photos[0], url: "javascript:alert(1)" }],
    };
    expect(parseUnsavedListingDraft(JSON.stringify(scriptUrl), { userId: "user_a", mode: "private", catalog })).toBeNull();
    const extra = { ...foreign.draft, userId: "user_a", trustDeclarationAccepted: true };
    expect(parseUnsavedListingDraft(JSON.stringify(extra), { userId: "user_a", mode: "private", catalog })).toBeNull();
    expect(save(storage, "user_a", "private", snapshot({ attributes: { body: "Panel" } })).ok).toBe(false);
  });

  it("clears only the requested draft", () => {
    const storage = memoryStorage();
    save(storage, "user_a", "private");
    save(storage, "user_a", "private", snapshot({ categoryId: "vans", attributes: { body: "Panel" }, title: "Van" }));
    clearUnsavedListingDraft(storage, { userId: "user_a", mode: "private", categoryId: "vans" });
    expect(storage.getItem(unsavedDraftStorageKey("user_a", "private", "cars"))).toContain("Blue bike");
    expect(storage.getItem(unsavedDraftStorageKey("user_a", "private", "vans"))).toBeNull();
    expect(storage.getItem(unsavedDraftPointerKey("user_a", "private"))).toBeNull();
  });

  it("reports quota failures without throwing", () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    const result = save(storage, "user_a", "private");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe(DRAFT_TEXT_QUOTA_MESSAGE);
  });
});

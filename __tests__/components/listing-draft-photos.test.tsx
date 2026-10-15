// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageUpload } from "@/components/marketplace/image-upload";
import {
  DRAFT_CORRUPT_MESSAGE,
  DRAFT_PHOTO_PARTIAL_MESSAGE,
  DRAFT_PHOTO_QUOTA_MESSAGE,
  DRAFT_RESTORED_MESSAGE,
  DRAFT_SAVED_MESSAGE,
  saveUnsavedListingDraft,
  snapshotFromDraft,
  unsavedDraftPointerKey,
  unsavedDraftStorageKey,
  type DraftCatalog,
  type KeyValueStorage,
  type UnsavedDraftSnapshot,
} from "@/app/(public)/sell/listing-unsaved-draft";
import {
  ListingDraftPhotoProvider,
  PHOTO_REFRESH_AFTER_MS,
  backupListingPhotoFile,
  createMemoryPhotoBlobStore,
  listingPhotoCacheKey,
  recoverDraftPhotos,
  useUnsavedListingDraft,
  type PhotoBlobStore,
} from "@/app/(public)/sell/listing-draft-photos";

vi.mock("@/lib/images/client-upload", () => ({
  preflightListingImageFile: vi.fn(async () => null),
  presentClientUploadError: (error: unknown) => (error instanceof Error ? error.message : "upload failed"),
  uploadListingImageFile: vi.fn(async () => {
    throw new Error("network disabled");
  }),
}));

const NOW = 1_700_000_000_000;
const now = () => NOW;
const catalog: DraftCatalog = {
  categories: [
    { id: "cars", attributeIds: ["make"] },
    { id: "vans", attributeIds: ["body"] },
  ],
  regionIds: ["region_north"],
};

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function emptySnapshot(): UnsavedDraftSnapshot {
  return {
    categoryId: "",
    title: "",
    description: "",
    price: "",
    regionId: "",
    attributes: {},
    registrationInput: "",
    catalogueSelection: { makeMode: "manual", modelMode: "manual" },
    photos: [],
    currentStep: 1,
  };
}

function photo(uploadedAt: number, overrides: Record<string, unknown> = {}) {
  return {
    uploadIntentId: "intent_1",
    url: "https://cdn.example.com/old.jpg",
    publicId: "iommarket/listings/staging/user/intent_1",
    provider: "CLOUDINARY" as const,
    order: 2,
    focalX: 0.2,
    focalY: 0.8,
    uploadedAt,
    ...overrides,
  };
}

function seed(storage: KeyValueStorage, snapshot: UnsavedDraftSnapshot, userId = "user_a") {
  const saved = saveUnsavedListingDraft(storage, {
    userId,
    mode: "private",
    snapshot,
    catalog,
    uploadedAtByIntent: {},
    now: NOW,
  });
  if (!saved.ok) throw new Error(saved.message);
  return saved.draft;
}

function Harness({
  storage,
  photoStore,
  uploadFile,
  enabled = true,
  userId = "user_a",
}: {
  storage: KeyValueStorage;
  photoStore: PhotoBlobStore;
  uploadFile?: (file: File) => Promise<{
    uploadIntentId: string;
    url: string;
    publicId: string;
    provider: "CLOUDINARY";
    width?: number;
    height?: number;
    format?: string;
    bytes?: number;
  }>;
  enabled?: boolean;
  userId?: string;
}) {
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const draft = useUnsavedListingDraft({
    enabled,
    userId,
    mode: "private",
    catalog,
    snapshot,
    storage,
    photoStore,
    uploadFile,
    now,
    applyDraft: (next) => setSnapshot(snapshotFromDraft(next)),
    resetFields: () => setSnapshot(emptySnapshot()),
  });
  return (
    <div>
      <p data-testid="message">{draft.message}</p>
      <p data-testid="warning">{draft.warning}</p>
      <p data-testid="recovering">{draft.recovering ? "yes" : "no"}</p>
      <p data-testid="title">{snapshot.title}</p>
      <p data-testid="attrs">{JSON.stringify(snapshot.attributes)}</p>
      <p data-testid="photos">{snapshot.photos.map((item) => `${item.uploadIntentId}:${item.order}:${item.focalX}`).join("|")}</p>
      <button type="button" onClick={() => setSnapshot((current) => ({ ...current, categoryId: "cars", title: "Blue bike", attributes: { make: "Ford" } }))}>
        fill
      </button>
      <button type="button" onClick={() => setSnapshot((current) => ({ ...current, categoryId: "vans", attributes: {} }))}>
        switch
      </button>
      <button type="button" onClick={draft.discard}>discard</button>
      <button type="button" onClick={draft.commitClear}>clear</button>
    </div>
  );
}

describe("listing draft photos", () => {
  afterEach(() => cleanup());

  it("refreshes expired cached files and keeps fresh, linked, and failed photos honest", async () => {
    const store = createMemoryPhotoBlobStore();
    const cached = new File(["fresh-bytes"], "car.jpg", { type: "image/jpeg" });
    const expired = photo(NOW - PHOTO_REFRESH_AFTER_MS - 1);
    await store.put(listingPhotoCacheKey("user_a", "private", "cars", "intent_1"), { file: cached, savedAt: expired.uploadedAt });
    const uploadFile = vi.fn(async () => ({
      uploadIntentId: "intent_new",
      url: "https://cdn.example.com/new.jpg",
      publicId: "iommarket/listings/staging/user/intent_new",
      provider: "CLOUDINARY" as const,
      width: 1200,
      height: 800,
      format: "jpg",
      bytes: 1200,
    }));

    const refreshed = await recoverDraftPhotos({
      photos: [expired, photo(NOW - 60_000, { uploadIntentId: "intent_fresh", order: 0 }), photo(expired.uploadedAt, { uploadIntentId: "intent_linked", listingImageId: "img_1", order: 1 })],
      userId: "user_a",
      mode: "private",
      categoryId: "cars",
      store,
      uploadFile,
      now: NOW,
    });
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(uploadFile).toHaveBeenCalledWith(cached);
    expect(refreshed.warning).toBeNull();
    expect(refreshed.photos.map((item) => item.uploadIntentId)).toEqual(["intent_new", "intent_fresh", "intent_linked"]);
    expect(refreshed.photos[0]).toMatchObject({ order: 2, focalX: 0.2, focalY: 0.8, publicId: "iommarket/listings/staging/user/intent_new" });

    const missing = await recoverDraftPhotos({
      photos: [photo(NOW - PHOTO_REFRESH_AFTER_MS - 1, { uploadIntentId: "missing" })],
      userId: "user_a",
      mode: "private",
      categoryId: "cars",
      store,
      uploadFile,
      now: NOW,
    });
    expect(missing.photos[0].uploadIntentId).toBe("missing");
    expect(missing.failedIds).toEqual(["missing"]);
    expect(missing.warning).toBe(DRAFT_PHOTO_PARTIAL_MESSAGE);

    uploadFile.mockRejectedValueOnce(new Error("upload failed"));
    const failed = await recoverDraftPhotos({
      photos: [expired],
      userId: "user_a",
      mode: "private",
      categoryId: "cars",
      store,
      uploadFile,
      now: NOW,
    });
    expect(failed.warning).toBe(DRAFT_PHOTO_PARTIAL_MESSAGE);
    expect(failed.photos).toEqual([expired]);
    expect(failed.failedIds).toEqual([expired.uploadIntentId]);
  });

  it("surfaces quota failures and still allows the caller to keep text", async () => {
    const result = await backupListingPhotoFile({
      userId: "user_a",
      mode: "private",
      categoryId: "cars",
      intentId: "intent_1",
      file: new File(["x"], "car.jpg", { type: "image/jpeg" }),
      store: {
        async put() {
          throw new DOMException("full", "QuotaExceededError");
        },
        async get() {
          return undefined;
        },
        async deletePrefix() {
          return undefined;
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe(DRAFT_PHOTO_QUOTA_MESSAGE);
  });

  it("restores the signed-in draft once, isolates categories, and clears only that draft", async () => {
    const storage = memoryStorage();
    const photoStore = createMemoryPhotoBlobStore();
    seed(storage, {
      ...emptySnapshot(),
      categoryId: "vans",
      title: "Stored van",
      attributes: { body: "Panel" },
    });
    seed(storage, {
      ...emptySnapshot(),
      categoryId: "cars",
      title: "Stored car",
      attributes: { make: "Ford" },
    });
    const other = memoryStorage();
    seed(other, { ...emptySnapshot(), categoryId: "cars", title: "Other person", attributes: { make: "Audi" } }, "user_b");
    storage.setItem(
      unsavedDraftStorageKey("user_b", "private", "cars"),
      other.getItem(unsavedDraftStorageKey("user_b", "private", "cars")) ?? "",
    );

    render(<Harness storage={storage} photoStore={photoStore} />);
    await waitFor(() => expect(screen.getByTestId("title")).toHaveTextContent("Stored car"));
    expect(screen.getByTestId("message")).toHaveTextContent(DRAFT_RESTORED_MESSAGE);
    expect(screen.getByTestId("attrs")).toHaveTextContent("Ford");

    fireEvent.click(screen.getByText("switch"));
    await waitFor(() => expect(screen.getByTestId("attrs")).toHaveTextContent("Panel"));
    expect(storage.getItem(unsavedDraftStorageKey("user_a", "private", "cars"))).toContain("Ford");
    expect(storage.getItem(unsavedDraftStorageKey("user_a", "private", "vans"))).toContain("Panel");
    expect(storage.getItem(unsavedDraftStorageKey("user_b", "private", "cars"))).toContain("Other person");

    fireEvent.click(screen.getByText("clear"));
    await waitFor(() => expect(storage.getItem(unsavedDraftStorageKey("user_a", "private", "vans"))).toBeNull());
    expect(storage.getItem(unsavedDraftStorageKey("user_a", "private", "cars"))).toContain("Ford");
    expect(storage.getItem(unsavedDraftStorageKey("user_b", "private", "cars"))).toContain("Other person");
  });

  it("does not restore or overwrite a draft when recovery is disabled", async () => {
    const storage = memoryStorage();
    seed(storage, { ...emptySnapshot(), categoryId: "cars", title: "Stored car", attributes: { make: "Ford" } });
    render(<Harness storage={storage} photoStore={createMemoryPhotoBlobStore()} enabled={false} />);
    expect(screen.getByTestId("title")).toHaveTextContent("");
    fireEvent.click(screen.getByText("fill"));
    expect(screen.getByTestId("title")).toHaveTextContent("Blue bike");
    expect(storage.getItem(unsavedDraftStorageKey("user_a", "private", "cars"))).toContain("Stored car");
  });

  it("persists on pagehide, discards the current draft, and warns on corrupt storage", async () => {
    const storage = memoryStorage();
    let writes = 0;
    const setItem = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      writes += 1;
      setItem(key, value);
    };
    render(<Harness storage={storage} photoStore={createMemoryPhotoBlobStore()} />);
    fireEvent.click(screen.getByText("fill"));
    await waitFor(() => expect(screen.getByTestId("message")).toHaveTextContent(DRAFT_SAVED_MESSAGE));
    const savedWrites = writes;
    window.dispatchEvent(new Event("pagehide"));
    expect(writes).toBeGreaterThan(savedWrites);
    expect(storage.getItem(unsavedDraftStorageKey("user_a", "private", "cars"))).toContain("Blue bike");

    fireEvent.click(screen.getByText("discard"));
    await waitFor(() => expect(screen.getByTestId("title")).toHaveTextContent(""));
    expect(storage.getItem(unsavedDraftStorageKey("user_a", "private", "cars"))).toBeNull();

    cleanup();
    const corrupt = memoryStorage();
    corrupt.setItem(unsavedDraftStorageKey("user_a", "private", ""), "{");
    corrupt.setItem(unsavedDraftPointerKey("user_a", "private"), JSON.stringify({ version: 1, categoryId: "" }));
    render(<Harness storage={corrupt} photoStore={createMemoryPhotoBlobStore()} />);
    await waitFor(() => expect(screen.getByTestId("warning")).toHaveTextContent(DRAFT_CORRUPT_MESSAGE));
    expect(screen.getByTestId("title")).toHaveTextContent("");
  });

  it("blocks recovery until an expired cached photo is uploaded again", async () => {
    const storage = memoryStorage();
    const photoStore = createMemoryPhotoBlobStore();
    const file = new File(["pixels"], "car.jpg", { type: "image/jpeg" });
    seed(storage, {
      ...emptySnapshot(),
      categoryId: "cars",
      title: "Stored car",
      attributes: { make: "Ford" },
      photos: [photo(NOW - PHOTO_REFRESH_AFTER_MS - 5_000)],
      currentStep: 2,
    });
    await photoStore.put(listingPhotoCacheKey("user_a", "private", "cars", "intent_1"), { file, savedAt: NOW });
    let release: (value: { uploadIntentId: string; url: string; publicId: string; provider: "CLOUDINARY" }) => void = () => undefined;
    const uploadFile = vi.fn(
      () =>
        new Promise<{ uploadIntentId: string; url: string; publicId: string; provider: "CLOUDINARY" }>((resolve) => {
          release = resolve;
        }),
    );
    render(<Harness storage={storage} photoStore={photoStore} uploadFile={uploadFile} />);
    await waitFor(() => expect(screen.getByTestId("recovering")).toHaveTextContent("yes"));
    expect(screen.getByTestId("title")).toHaveTextContent("Stored car");
    fireEvent.click(screen.getByRole("button", { name: "fill" }));
    release({
      uploadIntentId: "intent_new",
      url: "https://cdn.example.com/new.jpg",
      publicId: "iommarket/listings/staging/user/intent_new",
      provider: "CLOUDINARY",
    });
    await waitFor(() => expect(screen.getByTestId("recovering")).toHaveTextContent("no"));
    expect(screen.getByTestId("photos")).toHaveTextContent("intent_new:2:0.2");
    expect(screen.getByTestId("title")).toHaveTextContent("Blue bike");
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect((await photoStore.get(listingPhotoCacheKey("user_a", "private", "cars", "intent_new")))?.file).toBe(file);
    expect(screen.getByTestId("warning")).toHaveTextContent("");
  });

  it("asks ImageUpload to back up a successful file without a network call", async () => {
    const photoStore = createMemoryPhotoBlobStore();
    const { uploadListingImageFile } = await import("@/lib/images/client-upload");
    vi.mocked(uploadListingImageFile).mockResolvedValueOnce({
      uploadIntentId: "intent_ui",
      url: "",
      publicId: "iommarket/listings/staging/user/intent_ui",
      provider: "CLOUDINARY",
      width: 800,
      height: 600,
      format: "jpg",
      bytes: 10,
    });
    const { container } = render(
      <ListingDraftPhotoProvider userId="user_a" mode="private" categoryId="cars" enabled photoStore={photoStore}>
        <ImageUpload images={[]} onImagesChange={() => undefined} />
      </ListingDraftPhotoProvider>,
    );
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("file input missing");
    const file = new File(["pixels"], "car.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(async () => {
      const cached = await photoStore.get(listingPhotoCacheKey("user_a", "private", "cars", "intent_ui"));
      expect(cached?.file).toBe(file);
    });
    expect(uploadListingImageFile).toHaveBeenCalledWith(file);
  });
});

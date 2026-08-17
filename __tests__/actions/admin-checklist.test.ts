import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireRoleMock,
  logAdminActionMock,
  captureExceptionMock,
  revalidatePathMock,
  mockDb,
} = vi.hoisted(() => {
  const mockDb = {
    siteSetting: {
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  mockDb.$transaction.mockImplementation(
    async (callback: (tx: typeof mockDb) => unknown) => callback(mockDb),
  );
  return {
    requireRoleMock: vi.fn(),
    logAdminActionMock: vi.fn(),
    captureExceptionMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    mockDb,
  };
});

vi.mock("@/lib/auth", () => ({
  requireRole: requireRoleMock,
}));

vi.mock("@/lib/db", () => ({
  db: mockDb,
}));

vi.mock("@/lib/admin/audit", () => ({
  logAdminAction: logAdminActionMock,
}));

vi.mock("@/lib/monitoring", () => ({
  captureException: captureExceptionMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

import {
  loadChecklist,
  saveChecklist,
  updateChecklistCompletion,
} from "@/actions/admin/checklist";
import {
  CHECKLIST_SETTING_KEY,
  createChecklistItem,
  createDefaultChecklistItems,
} from "@/lib/admin/checklist";

const NOW = new Date("2026-08-14T21:00:00.000Z");
const ROW_UPDATED_AT = new Date("2026-08-14T21:05:00.000Z");
const NEXT_ROW_UPDATED_AT = new Date("2026-08-14T21:06:00.000Z");

describe("loadChecklist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({
      id: "cladminxxxxxxxxxxxxxxxxxx",
      role: "ADMIN",
    });
  });

  it("seeds the default checklist when none is stored", async () => {
    mockDb.siteSetting.findUnique.mockResolvedValue(null);
    mockDb.siteSetting.create.mockResolvedValue({
      key: CHECKLIST_SETTING_KEY,
      value: [],
      updatedAt: ROW_UPDATED_AT,
    });

    const result = await loadChecklist();

    expect(result.error).toBeUndefined();
    expect(result.data?.items).toHaveLength(7);
    expect(result.data?.items[0]?.title).toBe("GDPR advice");
    expect(result.data?.updatedAt).toBe(ROW_UPDATED_AT.toISOString());
    expect(mockDb.siteSetting.create).toHaveBeenCalledWith({
      data: {
        key: CHECKLIST_SETTING_KEY,
        value: expect.arrayContaining([
          expect.objectContaining({ id: "seed-gdpr-advice" }),
        ]),
      },
    });
  });

  it("returns stored items without re-seeding", async () => {
    const stored = [
      createChecklistItem({ id: "custom", title: "Custom item" }, NOW),
    ];
    mockDb.siteSetting.findUnique.mockResolvedValue({
      key: CHECKLIST_SETTING_KEY,
      value: stored,
      updatedAt: ROW_UPDATED_AT,
    });

    const result = await loadChecklist();

    expect(result.data).toEqual({
      items: stored,
      updatedAt: ROW_UPDATED_AT.toISOString(),
    });
    expect(mockDb.siteSetting.create).not.toHaveBeenCalled();
  });

  it("refuses a malformed stored snapshot without dropping entries MD-CLOSE-002", async () => {
    mockDb.siteSetting.findUnique.mockResolvedValue({
      key: CHECKLIST_SETTING_KEY,
      value: [
        createChecklistItem({ id: "valid", title: "Valid item" }, NOW),
        { id: "malformed" },
      ],
      updatedAt: ROW_UPDATED_AT,
    });

    await expect(loadChecklist()).resolves.toEqual({
      error: "The stored checklist is malformed. No entries were loaded or saved.",
    });
    expect(mockDb.siteSetting.create).not.toHaveBeenCalled();
  });
});

describe("saveChecklist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({
      id: "cladminxxxxxxxxxxxxxxxxxx",
      role: "ADMIN",
    });
    mockDb.siteSetting.updateMany.mockResolvedValue({ count: 1 });
    mockDb.siteSetting.findUniqueOrThrow.mockResolvedValue({
      key: CHECKLIST_SETTING_KEY,
      value: [],
      updatedAt: NEXT_ROW_UPDATED_AT,
    });
  });

  it("persists a valid checklist and revalidates the admin page", async () => {
    const items = createDefaultChecklistItems(NOW).map((item, index) =>
      index === 0 ? { ...item, done: true } : item,
    );

    mockDb.siteSetting.findUnique.mockResolvedValue({
      key: CHECKLIST_SETTING_KEY,
      value: items,
      updatedAt: ROW_UPDATED_AT,
    });
    const result = await saveChecklist({
      items,
      expectedUpdatedAt: ROW_UPDATED_AT.toISOString(),
    });

    expect(result.error).toBeUndefined();
    expect(mockDb.siteSetting.updateMany).toHaveBeenCalledWith({
      where: {
        key: CHECKLIST_SETTING_KEY,
        updatedAt: ROW_UPDATED_AT,
      },
      data: { value: items },
    });
    expect(logAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SAVE_ADMIN_CHECKLIST",
        entityId: CHECKLIST_SETTING_KEY,
        details: { total: 7, remaining: 6 },
      }),
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/checklist");
  });

  it("rejects an item with a blank title", async () => {
    const result = await saveChecklist({
      items: [
        createChecklistItem({ title: "Valid" }, NOW),
        {
          ...createChecklistItem({ title: "Valid" }, NOW),
          title: "   ",
        },
      ],
      expectedUpdatedAt: ROW_UPDATED_AT.toISOString(),
    });

    expect(result.error).toBeDefined();
    expect(mockDb.siteSetting.updateMany).not.toHaveBeenCalled();
  });

  it("rejects duplicate item identifiers before CAS", async () => {
    const duplicate = createChecklistItem(
      { id: "duplicate", title: "First" },
      NOW,
    );
    const result = await saveChecklist({
      items: [duplicate, { ...duplicate, title: "Second" }],
      expectedUpdatedAt: ROW_UPDATED_AT.toISOString(),
    });

    expect(result).toEqual({
      error: "Stored checklist contains duplicate item identifiers.",
    });
    expect(mockDb.siteSetting.findUnique).not.toHaveBeenCalled();
    expect(mockDb.siteSetting.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a stale whole-snapshot save MD-CLOSE-001", async () => {
    const items = createDefaultChecklistItems(NOW);
    mockDb.siteSetting.findUnique.mockResolvedValue({
      key: CHECKLIST_SETTING_KEY,
      value: items,
      updatedAt: ROW_UPDATED_AT,
    });
    mockDb.siteSetting.updateMany.mockResolvedValue({ count: 0 });

    const result = await saveChecklist({
      items,
      expectedUpdatedAt: new Date(
        ROW_UPDATED_AT.getTime() - 1_000,
      ).toISOString(),
    });

    expect(result.error).toContain("changed in another session");
    expect(logAdminActionMock).not.toHaveBeenCalled();
  });
});

describe("updateChecklistCompletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({
      id: "cladminxxxxxxxxxxxxxxxxxx",
      role: "ADMIN",
    });
  });

  it("updates only the expected item with row and item concurrency MD-CLOSE-003", async () => {
    const items = [
      createChecklistItem({ id: "first", title: "First" }, NOW),
      createChecklistItem(
        { id: "second", title: "Second" },
        new Date(NOW.getTime() + 1),
      ),
    ];
    mockDb.siteSetting.findUnique.mockResolvedValue({
      key: CHECKLIST_SETTING_KEY,
      value: items,
      updatedAt: ROW_UPDATED_AT,
    });
    mockDb.siteSetting.updateMany.mockResolvedValue({ count: 1 });
    mockDb.siteSetting.findUniqueOrThrow.mockResolvedValue({
      key: CHECKLIST_SETTING_KEY,
      value: [],
      updatedAt: NEXT_ROW_UPDATED_AT,
    });

    const result = await updateChecklistCompletion({
      itemId: "first",
      done: true,
      expectedUpdatedAt: ROW_UPDATED_AT.toISOString(),
      expectedItemUpdatedAt: items[0].updatedAt,
    });

    expect(result.data?.items).toEqual([
      expect.objectContaining({ id: "first", done: true }),
      items[1],
    ]);
    expect(mockDb.siteSetting.updateMany).toHaveBeenCalledWith({
      where: {
        key: CHECKLIST_SETTING_KEY,
        updatedAt: ROW_UPDATED_AT,
      },
      data: {
        value: [
          expect.objectContaining({ id: "first", done: true }),
          items[1],
        ],
      },
    });
  });

  it("rejects a stale item timestamp before row CAS", async () => {
    const items = [
      createChecklistItem({ id: "first", title: "First" }, NOW),
    ];
    mockDb.siteSetting.findUnique.mockResolvedValue({
      key: CHECKLIST_SETTING_KEY,
      value: items,
      updatedAt: ROW_UPDATED_AT,
    });

    const result = await updateChecklistCompletion({
      itemId: "first",
      done: true,
      expectedUpdatedAt: ROW_UPDATED_AT.toISOString(),
      expectedItemUpdatedAt: new Date(NOW.getTime() - 1_000).toISOString(),
    });

    expect(result.error).toContain("changed in another session");
    expect(mockDb.siteSetting.updateMany).not.toHaveBeenCalled();
  });
});

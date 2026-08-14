import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireRoleMock,
  logAdminActionMock,
  captureExceptionMock,
  revalidatePathMock,
  mockDb,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  logAdminActionMock: vi.fn(),
  captureExceptionMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  mockDb: {
    siteSetting: {
      findUnique: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

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
} from "@/actions/admin/checklist";
import {
  CHECKLIST_SETTING_KEY,
  createChecklistItem,
  createDefaultChecklistItems,
} from "@/lib/admin/checklist";

const NOW = new Date("2026-08-14T21:00:00.000Z");

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
    });

    const result = await loadChecklist();

    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(7);
    expect(result.data?.[0]?.title).toBe("GDPR advice");
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
    });

    const result = await loadChecklist();

    expect(result.data).toEqual(stored);
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
    mockDb.siteSetting.upsert.mockResolvedValue({
      key: CHECKLIST_SETTING_KEY,
      value: [],
    });
  });

  it("persists a valid checklist and revalidates the admin page", async () => {
    const items = createDefaultChecklistItems(NOW).map((item, index) =>
      index === 0 ? { ...item, done: true } : item,
    );

    const result = await saveChecklist({ items });

    expect(result.error).toBeUndefined();
    expect(mockDb.siteSetting.upsert).toHaveBeenCalledWith({
      where: { key: CHECKLIST_SETTING_KEY },
      update: { value: items },
      create: { key: CHECKLIST_SETTING_KEY, value: items },
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
    });

    expect(result.error).toBeDefined();
    expect(mockDb.siteSetting.upsert).not.toHaveBeenCalled();
  });
});

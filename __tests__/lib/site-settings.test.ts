import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    siteSetting: {
      findMany: vi.fn(),
    },
  },
}));

import { getSetting, getNumberSetting, getStringSetting, getBoolSetting, invalidateSettingsCache, SETTING_KEYS } from "@/lib/config/site-settings";
import { db } from "@/lib/db";

const mockFindMany = vi.mocked(db.siteSetting.findMany);

beforeEach(() => {
  invalidateSettingsCache();
  vi.clearAllMocks();
});

describe("getSetting", () => {
  it("returns fallback when no DB settings exist", async () => {
    mockFindMany.mockResolvedValue([]);
    const result = await getSetting("nonexistent_key", 42);
    expect(result).toBe(42);
  });

  it("returns DB value when present", async () => {
    mockFindMany.mockResolvedValue([
      { key: "listing_fee_pence", value: 999, updatedAt: new Date() },
    ]);
    const result = await getSetting("listing_fee_pence", 499);
    expect(result).toBe(999);
  });

  it("caches results and does not re-query within TTL", async () => {
    mockFindMany.mockResolvedValue([
      { key: "test_key", value: "cached_value", updatedAt: new Date() },
    ]);

    await getSetting("test_key", "default");
    await getSetting("test_key", "default");

    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  it("invalidateSettingsCache forces a re-query", async () => {
    mockFindMany.mockResolvedValue([]);
    await getSetting("key", "v1");

    invalidateSettingsCache();
    mockFindMany.mockResolvedValue([
      { key: "key", value: "v2", updatedAt: new Date() },
    ]);

    const result = await getSetting("key", "v1");
    expect(result).toBe("v2");
    expect(mockFindMany).toHaveBeenCalledTimes(2);
  });
});

describe("getNumberSetting", () => {
  it("returns number from DB", async () => {
    mockFindMany.mockResolvedValue([
      { key: SETTING_KEYS.LISTING_FEE_PENCE, value: 750, updatedAt: new Date() },
    ]);
    const result = await getNumberSetting(SETTING_KEYS.LISTING_FEE_PENCE, 499);
    expect(result).toBe(750);
  });

  it("returns fallback for NaN value", async () => {
    mockFindMany.mockResolvedValue([
      { key: "bad_key", value: "not-a-number", updatedAt: new Date() },
    ]);
    const result = await getNumberSetting("bad_key", 100);
    expect(result).toBe(100);
  });
});

describe("getStringSetting", () => {
  it("returns string from DB", async () => {
    mockFindMany.mockResolvedValue([
      { key: "str_key", value: "hello", updatedAt: new Date() },
    ]);
    const result = await getStringSetting("str_key", "default");
    expect(result).toBe("hello");
  });

  it("returns fallback for non-string value", async () => {
    mockFindMany.mockResolvedValue([
      { key: "num_key", value: 123, updatedAt: new Date() },
    ]);
    const result = await getStringSetting("num_key", "default");
    expect(result).toBe("default");
  });
});

describe("getBoolSetting", () => {
  it("returns boolean from DB", async () => {
    mockFindMany.mockResolvedValue([
      { key: "bool_key", value: true, updatedAt: new Date() },
    ]);
    const result = await getBoolSetting("bool_key", false);
    expect(result).toBe(true);
  });
});

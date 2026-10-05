import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SAMPLE_VISIBILITY } from "@/lib/listings/sample-visibility";
import { PROFILE_SAVE_FAILED } from "@/lib/admin/profile-edit";

const USER_ID = "clxxxxxxxxxxxxxxxxxxxxxxxxx";
const DEALER_ID = "cldealerxxxxxxxxxxxxxxxxx";
const OTHER_DEALER_ID = "clotherdealerxxxxxxxxxxxxx";
const ADMIN_ID = "cladminxxxxxxxxxxxxxxxxxxx";
const REGION_ID = "clregionxxxxxxxxxxxxxxxxxx";
const OTHER_USER_ID = "clotheruserxxxxxxxxxxxxxxxx";
const STARTED = new Date("2026-10-04T12:00:00.000Z");

const {
  requireRoleMock,
  logAdminActionMock,
  reportHandledExceptionMock,
  revalidatePathMock,
  getSampleVisibilityMock,
  state,
  tx,
} = vi.hoisted(() => {
  const state = {
    user: null as null | {
      id: string;
      name: string | null;
      phone: string | null;
      bio: string | null;
      regionId: string | null;
      email: string;
      authUserId: string;
      deletedAt: Date | null;
      disabledAt: Date | null;
      updatedAt: Date;
    },
    dealer: null as null | {
      id: string;
      userId: string;
      name: string;
      slug: string;
      phone: string | null;
      website: string | null;
      bio: string | null;
      isAdminPreview: boolean;
      updatedAt: Date;
    },
    audits: [] as Array<Record<string, unknown>>,
    otherDealerName: "Unrelated Motors",
    failDealer: false,
    failAudit: false,
  };
  const tx = {
    $queryRaw: vi.fn(),
    user: { updateMany: vi.fn(), findUnique: vi.fn() },
    dealerProfile: { updateMany: vi.fn(), findUnique: vi.fn() },
    region: { findFirst: vi.fn() },
  };
  return {
    requireRoleMock: vi.fn(),
    logAdminActionMock: vi.fn(),
    reportHandledExceptionMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    getSampleVisibilityMock: vi.fn(),
    state,
    tx,
  };
});

vi.mock("@/lib/auth", () => ({ requireRole: requireRoleMock }));
vi.mock("@/lib/admin/audit", () => ({ logAdminAction: logAdminActionMock }));
vi.mock("@/lib/monitoring", () => ({ reportHandledException: reportHandledExceptionMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/listings/sample-visibility", async () => {
  const actual = await vi.importActual<typeof import("@/lib/listings/sample-visibility")>(
    "@/lib/listings/sample-visibility",
  );
  return { ...actual, getSampleVisibility: getSampleVisibilityMock };
});
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => {
      const snapshot = {
        user: state.user ? { ...state.user, updatedAt: new Date(state.user.updatedAt) } : null,
        dealer: state.dealer ? { ...state.dealer, updatedAt: new Date(state.dealer.updatedAt) } : null,
        audits: [...state.audits],
        otherDealerName: state.otherDealerName,
      };
      try {
        return await callback(tx);
      } catch (error) {
        state.user = snapshot.user;
        state.dealer = snapshot.dealer;
        state.audits = snapshot.audits;
        state.otherDealerName = snapshot.otherDealerName;
        throw error;
      }
    }),
  },
}));

function resetState() {
  state.user = {
    id: USER_ID,
    name: "Account Holder",
    phone: "01624 111111",
    bio: "Account bio",
    regionId: REGION_ID,
    email: "holder@example.com",
    authUserId: "11111111-1111-1111-1111-111111111111",
    deletedAt: null,
    disabledAt: null,
    updatedAt: new Date(STARTED),
  };
  state.dealer = {
    id: DEALER_ID,
    userId: USER_ID,
    name: "Ocean Motor Village Preview",
    slug: "ocean-motor-village",
    phone: "01624 222222",
    website: "https://www.oceanmotorvillage.com",
    bio: "Dealer bio",
    isAdminPreview: false,
    updatedAt: new Date(STARTED),
  };
  state.audits = [];
  state.otherDealerName = "Unrelated Motors";
  state.failDealer = false;
  state.failAudit = false;
}

function dealerPayload(name = "Ocean Motor Village", extra: Record<string, unknown> = {}) {
  return {
    userId: USER_ID,
    expectedUserUpdatedAt: state.user!.updatedAt.toISOString(),
    dealer: {
      dealerId: DEALER_ID,
      expectedDealerUpdatedAt: state.dealer!.updatedAt.toISOString(),
      name,
      ...extra,
    },
  };
}

describe("saveAdminProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    resetState();
    requireRoleMock.mockResolvedValue({ id: ADMIN_ID, role: "ADMIN" });
    getSampleVisibilityMock.mockResolvedValue(DEFAULT_SAMPLE_VISIBILITY);
    reportHandledExceptionMock.mockResolvedValue(undefined);
    tx.$queryRaw.mockImplementation(async (query: TemplateStringsArray, id: string) => {
      const sql = query.join(" ");
      if (sql.includes('"User"')) return id === state.user?.id ? [state.user] : [];
      if (sql.includes('"DealerProfile"')) {
        return state.dealer && id === state.dealer.userId ? [state.dealer] : [];
      }
      return [];
    });
    tx.user.updateMany.mockImplementation(async ({ where, data }) => {
      if (!state.user || where.id !== state.user.id) return { count: 0 };
      if (new Date(where.updatedAt).getTime() !== state.user.updatedAt.getTime()) return { count: 0 };
      state.user = { ...state.user, ...data, updatedAt: new Date(state.user.updatedAt.getTime() + 1000) };
      return { count: 1 };
    });
    tx.dealerProfile.updateMany.mockImplementation(async ({ where, data }) => {
      if (state.failDealer) throw new Error("dealer write failed");
      if (where.id === OTHER_DEALER_ID) {
        state.otherDealerName = String(data.name ?? state.otherDealerName);
        return { count: 1 };
      }
      if (!state.dealer || where.id !== state.dealer.id || where.userId !== state.dealer.userId) {
        return { count: 0 };
      }
      if (new Date(where.updatedAt).getTime() !== state.dealer.updatedAt.getTime()) return { count: 0 };
      state.dealer = { ...state.dealer, ...data, updatedAt: new Date(state.dealer.updatedAt.getTime() + 1000) };
      return { count: 1 };
    });
    tx.user.findUnique.mockImplementation(async () => state.user);
    tx.dealerProfile.findUnique.mockImplementation(async () => state.dealer);
    tx.region.findFirst.mockImplementation(async ({ where }) => (
      where.id === REGION_ID && where.active === true ? { id: REGION_ID } : null
    ));
    logAdminActionMock.mockImplementation(async (params: Record<string, unknown>) => {
      if (state.failAudit) throw new Error("audit failed");
      state.audits.push(params);
      return { id: "audit" };
    });
  });

  it("renames only the dealer and records that change", async () => {
    const { saveAdminProfile } = await import("@/actions/admin/profile-edit");
    const result = await saveAdminProfile({
      ...dealerPayload(),
      account: {
        name: "Account Holder",
        phone: "01624 111111",
        bio: "Account bio",
        regionId: REGION_ID,
      },
    });

    expect(result).toMatchObject({
      data: {
        unchanged: false,
        account: { name: "Account Holder" },
        dealer: { name: "Ocean Motor Village", slug: "ocean-motor-village" },
      },
    });
    expect(state.user?.name).toBe("Account Holder");
    expect(state.dealer).toMatchObject({
      id: DEALER_ID,
      userId: USER_ID,
      slug: "ocean-motor-village",
      isAdminPreview: false,
      phone: "01624 222222",
    });
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(tx.dealerProfile.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { name: "Ocean Motor Village" },
    }));
    expect(state.audits).toEqual([
      expect.objectContaining({
        adminId: ADMIN_ID,
        action: "UPDATE_DEALER_PROFILE",
        entityId: DEALER_ID,
        details: expect.objectContaining({
          fields: ["name"],
          before: { name: "Ocean Motor Village Preview" },
          after: { name: "Ocean Motor Village" },
        }),
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("holder@example.com");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/dealers");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dealers/ocean-motor-village");
    expect(revalidatePathMock).toHaveBeenCalledWith("/listings/[id]", "page");
  });

  it("preserves omitted optional fields and clears explicit ones", async () => {
    const { saveAdminProfile } = await import("@/actions/admin/profile-edit");
    await saveAdminProfile({
      userId: USER_ID,
      expectedUserUpdatedAt: state.user!.updatedAt.toISOString(),
      account: { phone: "" },
      dealer: {
        dealerId: DEALER_ID,
        expectedDealerUpdatedAt: state.dealer!.updatedAt.toISOString(),
        website: null,
      },
    });

    expect(state.user).toMatchObject({ name: "Account Holder", phone: null, bio: "Account bio" });
    expect(state.dealer).toMatchObject({
      name: "Ocean Motor Village Preview",
      phone: "01624 222222",
      website: null,
      bio: "Dealer bio",
    });
  });

  it("edits an account that has no dealer profile", async () => {
    state.dealer = null;
    const { saveAdminProfile } = await import("@/actions/admin/profile-edit");
    const result = await saveAdminProfile({
      userId: USER_ID,
      expectedUserUpdatedAt: STARTED.toISOString(),
      account: { name: "Private Seller" },
    });

    expect(result).toMatchObject({ data: { dealer: null, account: { name: "Private Seller" } } });
    expect(tx.dealerProfile.updateMany).not.toHaveBeenCalled();
    expect(state.audits).toEqual([
      expect.objectContaining({ action: "UPDATE_USER_PROFILE", entityId: USER_ID }),
    ]);
  });

  it("rejects a dealer id that is not linked to the selected user", async () => {
    const { saveAdminProfile } = await import("@/actions/admin/profile-edit");
    const result = await saveAdminProfile({
      userId: USER_ID,
      expectedUserUpdatedAt: STARTED.toISOString(),
      dealer: {
        dealerId: OTHER_DEALER_ID,
        expectedDealerUpdatedAt: STARTED.toISOString(),
        name: "Taken Over",
      },
    });

    expect(result).toEqual({ error: "This dealer profile does not belong to this account." });
    expect(state.dealer?.name).toBe("Ocean Motor Village Preview");
    expect(state.otherDealerName).toBe("Unrelated Motors");
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(tx.dealerProfile.updateMany).not.toHaveBeenCalled();
  });

  it("does not audit a save that changes nothing", async () => {
    const { saveAdminProfile } = await import("@/actions/admin/profile-edit");
    const result = await saveAdminProfile(dealerPayload("Ocean Motor Village Preview"));

    expect(result).toMatchObject({ data: { unchanged: true } });
    expect(state.audits).toEqual([]);
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(tx.dealerProfile.updateMany).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects a stale timestamp and a competing second save", async () => {
    const { saveAdminProfile } = await import("@/actions/admin/profile-edit");
    const originalUser = STARTED.toISOString();
    const originalDealer = STARTED.toISOString();
    const first = await saveAdminProfile(dealerPayload("Ocean Motor Village"));
    const second = await saveAdminProfile({
      userId: USER_ID,
      expectedUserUpdatedAt: originalUser,
      dealer: {
        dealerId: DEALER_ID,
        expectedDealerUpdatedAt: originalDealer,
        name: "Someone else",
      },
    });

    expect(first).toMatchObject({ data: { dealer: { name: "Ocean Motor Village" } } });
    expect(second).toEqual({
      error: "This profile changed while the editor was open. Reload and try again.",
      conflict: true,
    });
    expect(state.dealer?.name).toBe("Ocean Motor Village");
    expect(state.audits).toHaveLength(1);
    expect(reportHandledExceptionMock).not.toHaveBeenCalled();
  });

  it("rolls back the user write when the dealer write fails", async () => {
    state.failDealer = true;
    const { saveAdminProfile } = await import("@/actions/admin/profile-edit");
    const result = await saveAdminProfile({
      userId: USER_ID,
      expectedUserUpdatedAt: STARTED.toISOString(),
      account: { name: "Changed Account" },
      dealer: {
        dealerId: DEALER_ID,
        expectedDealerUpdatedAt: STARTED.toISOString(),
        name: "Changed Dealer",
      },
    });

    expect(result).toEqual({ error: PROFILE_SAVE_FAILED });
    expect(state.user?.name).toBe("Account Holder");
    expect(state.dealer?.name).toBe("Ocean Motor Village Preview");
    expect(state.audits).toEqual([]);
  });

  it("rolls back both writes when the audit insert fails", async () => {
    state.failAudit = true;
    const { saveAdminProfile } = await import("@/actions/admin/profile-edit");
    const result = await saveAdminProfile({
      userId: USER_ID,
      expectedUserUpdatedAt: STARTED.toISOString(),
      account: { name: "Changed Account" },
      dealer: {
        dealerId: DEALER_ID,
        expectedDealerUpdatedAt: STARTED.toISOString(),
        name: "Ocean Motor Village",
      },
    });

    expect(result).toEqual({ error: PROFILE_SAVE_FAILED });
    expect(state.user?.name).toBe("Account Holder");
    expect(state.dealer?.name).toBe("Ocean Motor Village Preview");
  });

  it("keeps a committed save when refreshing pages fails", async () => {
    revalidatePathMock.mockImplementation(() => {
      throw new Error("cache unavailable");
    });
    const { saveAdminProfile } = await import("@/actions/admin/profile-edit");
    const result = await saveAdminProfile(dealerPayload());

    expect(result).toMatchObject({
      data: { dealer: { name: "Ocean Motor Village" } },
      warning: expect.stringContaining("Profile saved"),
    });
    expect(state.dealer?.name).toBe("Ocean Motor Village");
    expect("error" in result).toBe(false);
  });

  it("refuses deleted accounts and still edits disabled ones", async () => {
    const { saveAdminProfile } = await import("@/actions/admin/profile-edit");
    state.user!.deletedAt = new Date("2026-09-01T00:00:00.000Z");
    const deleted = await saveAdminProfile(dealerPayload());
    expect(deleted).toEqual({
      error: "This account is deleted. Restore it before editing the profile.",
    });
    expect(tx.dealerProfile.updateMany).not.toHaveBeenCalled();

    resetState();
    state.user!.disabledAt = new Date("2026-09-01T00:00:00.000Z");
    const disabled = await saveAdminProfile(dealerPayload());
    expect(disabled).toMatchObject({ data: { dealer: { name: "Ocean Motor Village" } } });
    expect(state.user?.disabledAt).toEqual(new Date("2026-09-01T00:00:00.000Z"));
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });

  it("hides production preview-pack targets and unknown users", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ITRADER_DEPLOYMENT_ROLE", "production");
    state.dealer!.isAdminPreview = true;
    state.dealer!.name = "Harbour Cars";
    const { saveAdminProfile } = await import("@/actions/admin/profile-edit");
    const hidden = await saveAdminProfile(dealerPayload("Harbour Cars"));
    expect(hidden).toEqual({ error: "Account not found." });
    expect(tx.dealerProfile.updateMany).not.toHaveBeenCalled();

    resetState();
    const missing = await saveAdminProfile({
      ...dealerPayload(),
      userId: OTHER_USER_ID,
    });
    expect(missing).toEqual({ error: "Account not found." });
  });

  it("rejects a non-admin and does not export the loose dealer update", async () => {
    requireRoleMock.mockRejectedValue(new Error("Insufficient permissions"));
    const { saveAdminProfile } = await import("@/actions/admin/profile-edit");
    await expect(saveAdminProfile(dealerPayload())).rejects.toThrow("Insufficient permissions");

    const dealers = await import("@/actions/admin/dealers");
    expect("updateDealerProfile" in dealers).toBe(false);
  });

  it("supports two consecutive saves with the returned timestamps", async () => {
    const { saveAdminProfile } = await import("@/actions/admin/profile-edit");
    const first = await saveAdminProfile(dealerPayload());
    if (!("data" in first)) throw new Error("expected the first save to succeed");
    const second = await saveAdminProfile({
      userId: USER_ID,
      expectedUserUpdatedAt: first.data.userUpdatedAt,
      dealer: {
        dealerId: DEALER_ID,
        expectedDealerUpdatedAt: first.data.dealer!.updatedAt,
        phone: "",
      },
    });

    expect(second).toMatchObject({
      data: {
        dealer: { name: "Ocean Motor Village", phone: null },
      },
    });
    expect(state.dealer?.phone).toBeNull();
    expect(state.audits).toHaveLength(2);
  });
});

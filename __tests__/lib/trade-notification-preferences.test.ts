import { beforeEach, describe, expect, it, vi } from "vitest";
const { enabled, send } = vi.hoisted(() => ({ enabled: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/notifications/settings", () => ({ isNotificationEnabled: enabled }));
vi.mock("@/lib/email/client", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/email/client")>(), sendResendEmail: send }));
import { notifyTradeApplication, notifyTradeEnquiry, notifyTradeExpiry, notifyTradeSavedSearch } from "@/lib/trade-exchange/notify";
describe("Trade notification preferences", () => {
  beforeEach(() => { vi.clearAllMocks(); enabled.mockResolvedValue(true); send.mockResolvedValue(undefined); });
  it("does not send opted-out optional emails, while consuming saved-search matches", async () => {
    enabled.mockResolvedValue(false);
    await expect(notifyTradeEnquiry("owner@example.com")).resolves.toBe(true);
    await expect(notifyTradeExpiry("owner@example.com")).resolves.toBe(true);
    await expect(notifyTradeSavedSearch("owner@example.com", 3)).resolves.toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(enabled.mock.calls.map(call => call[0])).toEqual(["tradeMessages", "tradeListingUpdates", "tradeSavedSearchAlerts"]);
  });
  it("preserves default delivery and mandatory application notices", async () => {
    await expect(notifyTradeEnquiry("owner@example.com")).resolves.toBe(true);
    enabled.mockResolvedValue(false);
    await expect(notifyTradeApplication("owner@example.com")).resolves.toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(enabled).toHaveBeenCalledTimes(1);
  });
  it("reports preference lookup failures so saved searches can retry", async () => {
    enabled.mockRejectedValue(new Error("unavailable"));
    await expect(notifyTradeSavedSearch("owner@example.com", 1)).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

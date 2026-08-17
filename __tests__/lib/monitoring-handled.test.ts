import { beforeEach, describe, expect, it, vi } from "vitest";

const captureException = vi.fn();

vi.mock("@/lib/monitoring/capture", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

import {
  isExpectedControlFlowError,
  isExpectedHandledOutcome,
  reportHandledException,
} from "@/lib/monitoring/handled";

describe("MON-HANDLED-004 handled failure reporting", () => {
  beforeEach(() => {
    captureException.mockReset();
    captureException.mockResolvedValue(null);
  });

  it("reports genuine handled failures", async () => {
    await reportHandledException({
      error: new Error("db write failed"),
      action: "updateMyProfile",
      route: "/account/profile",
      userId: "user-1",
    });

    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "SERVER",
        action: "updateMyProfile",
        route: "/account/profile",
        tags: expect.objectContaining({ handled: true }),
      }),
    );
  });

  it("does not convert expected validation/auth/control-flow outcomes into errors", async () => {
    expect(
      isExpectedControlFlowError(
        Object.assign(new Error("NEXT_REDIRECT"), {
          digest: "NEXT_REDIRECT;replace;/sign-in;307",
        }),
      ),
    ).toBe(true);
    expect(
      isExpectedControlFlowError(
        Object.assign(new Error("not found"), { digest: "NEXT_NOT_FOUND" }),
      ),
    ).toBe(true);
    expect(
      isExpectedHandledOutcome(
        Object.assign(new Error("Invalid transition"), {
          name: "ListingLifecycleConflictError",
        }),
      ),
    ).toBe(true);

    await reportHandledException({
      error: Object.assign(new Error("redirect"), {
        digest: "NEXT_REDIRECT;replace;/sign-in;307",
      }),
      action: "requireAuth",
      route: "/account",
    });

    expect(captureException).not.toHaveBeenCalled();

    await reportHandledException({
      error: Object.assign(new Error("Invalid transition"), {
        name: "ListingLifecycleError",
      }),
      action: "moderateListing",
      route: "/admin/listings",
    });

    expect(captureException).not.toHaveBeenCalled();
  });
});

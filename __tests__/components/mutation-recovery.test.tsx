// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMutationRecovery } from "@/lib/forms/use-mutation-recovery";

afterEach(cleanup);
describe("uncertain mutation recovery", () => {
  it.each(["returned", "rejected"])("blocks a repeat after an uncertain %s result", async (kind) => {
    const operation = kind === "returned"
      ? vi.fn().mockResolvedValue({ error: "Check the recorded result.", code: "unknown", retryable: false })
      : vi.fn().mockRejectedValue(new Error("token=secret https://provider.example/private"));
    const { result } = renderHook(() => useMutationRecovery());
    await act(async () => { await result.current.run(operation); });
    expect(result.current.blocked).toBe(true);
    await act(async () => {
      const repeated = await result.current.run(operation);
      expect(JSON.stringify(repeated)).not.toMatch(/token=|provider\.example/);
    });
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it("allows correction after a known field error", async () => {
    const operation = vi.fn().mockResolvedValueOnce({ error: { notes: ["Explain the reason."] } }).mockResolvedValueOnce({ data: { saved: true } });
    const { result } = renderHook(() => useMutationRecovery());
    await act(async () => { await result.current.run(operation); });
    expect(result.current.blocked).toBe(false);
    await act(async () => { await result.current.run(operation); });
    expect(operation).toHaveBeenCalledTimes(2);
  });
});

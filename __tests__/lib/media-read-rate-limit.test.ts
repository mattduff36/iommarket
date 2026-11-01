import { describe, expect, it, vi } from "vitest";
import { createMediaReadLimiter } from "@/lib/media/read-rate-limit";

const unavailable = { allowed: false, remaining: 0, resetAt: 60_000, unavailable: true };
describe("media read protection", () => {
  it("survives a backend outage, bounds retries and recovers", async () => {
    let now = 1_000;
    const shared = vi.fn().mockResolvedValue(unavailable);
    const warn = vi.fn();
    const limit = createMediaReadLimiter(shared, () => now, warn);
    for (let i = 0; i < 240; i++) expect((await limit("client")).allowed).toBe(true);
    expect((await limit("client")).allowed).toBe(false);
    expect(shared).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    now += 60_000;
    shared.mockResolvedValue({ ...unavailable, unavailable: false });
    expect((await limit("client")).allowed).toBe(false);
    expect(shared).toHaveBeenCalledTimes(2);
  });

  it("never bypasses a real shared rate-limit denial", async () => {
    const shared = vi.fn().mockResolvedValue({ ...unavailable, unavailable: false });
    const limit = createMediaReadLimiter(shared, () => 1_000);
    expect((await limit("client")).allowed).toBe(false);
    expect((await limit("other")).allowed).toBe(false);
    expect(shared).toHaveBeenCalledTimes(2);
  });

  it("bounds client memory without evicting blocked clients", async () => {
    let now = 1_000;
    const limit = createMediaReadLimiter(vi.fn().mockResolvedValue(unavailable), () => now, () => {});
    for (let i = 0; i < 5_000; i++) expect((await limit(`client-${i}`)).allowed).toBe(true);
    expect((await limit("overflow")).allowed).toBe(false);
    now += 60_000;
    expect((await limit("overflow")).allowed).toBe(true);
  });

  it("retains a known denial when another client opens the outage circuit", async () => {
    const shared = vi.fn().mockResolvedValueOnce({ ...unavailable, unavailable: false }).mockResolvedValue(unavailable);
    const limit = createMediaReadLimiter(shared, () => 1_000, () => {});
    expect((await limit("blocked")).allowed).toBe(false);
    expect((await limit("other")).allowed).toBe(true);
    expect((await limit("blocked")).allowed).toBe(false);
    expect(shared).toHaveBeenCalledTimes(2);
  });
});

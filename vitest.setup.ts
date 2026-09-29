import { afterAll, afterEach, expect, vi } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";

if (typeof document !== "undefined") {
  expect.extend(matchers);

  const globalExpect = (globalThis as { expect?: typeof expect }).expect;
  if (typeof globalExpect?.extend === "function" && globalExpect !== expect) {
    globalExpect.extend(matchers);
  }
}

const originalEnv = { ...process.env };

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  vi.unstubAllEnvs();
  const originalKeys = new Set(Object.keys(originalEnv));
  for (const key of Object.keys(process.env)) {
    if (!originalKeys.has(key)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else if (process.env[key] !== value) {
      process.env[key] = value;
    }
  }
  vi.useRealTimers();
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub as typeof ResizeObserver;
}

class IntersectionObserverStub implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0];

  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver =
    IntersectionObserverStub as typeof IntersectionObserver;
}

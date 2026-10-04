import { expect, it, vi as importedVi } from "vitest";

it("uses the active Vitest runner for imported vi helpers", () => {
  const globalVi = (globalThis as { vi?: { mock: unknown } }).vi;
  expect(globalVi).toBeTruthy();
  expect(importedVi.mock).toBe(globalVi?.mock);
});

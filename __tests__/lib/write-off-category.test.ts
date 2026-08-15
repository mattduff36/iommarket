import { describe, expect, it } from "vitest";
import {
  isDisclosedWriteOff,
  isWriteOffCategoryValue,
  writeOffFromAttributeValues,
} from "@/lib/listings/write-off-category";

describe("write-off category POL-LIST-001", () => {
  it("accepts only None, Category N, and Category S", () => {
    expect(isWriteOffCategoryValue("None")).toBe(true);
    expect(isWriteOffCategoryValue("Category N")).toBe(true);
    expect(isWriteOffCategoryValue("Category S")).toBe(true);
    expect(isWriteOffCategoryValue("Category A")).toBe(false);
    expect(isWriteOffCategoryValue(undefined)).toBe(false);
  });

  it("treats Category N and S as disclosed write-offs", () => {
    expect(isDisclosedWriteOff("Category N")).toBe(true);
    expect(isDisclosedWriteOff("Category S")).toBe(true);
    expect(isDisclosedWriteOff("None")).toBe(false);
  });

  it("reads the write-off value from listing attribute rows", () => {
    expect(
      writeOffFromAttributeValues([
        { value: "BMW", attributeDefinition: { slug: "make" } },
        { value: "Category N", attributeDefinition: { slug: "write-off-category" } },
      ]),
    ).toBe("Category N");
  });
});

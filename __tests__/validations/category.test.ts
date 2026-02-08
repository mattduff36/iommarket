import { describe, it, expect } from "vitest";
import {
  createCategorySchema,
  createAttributeDefinitionSchema,
} from "@/lib/validations/category";

describe("createCategorySchema", () => {
  it("accepts valid category", () => {
    const result = createCategorySchema.safeParse({
      name: "Vehicles",
      slug: "vehicles",
      active: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid slug with spaces", () => {
    const result = createCategorySchema.safeParse({
      name: "Hi Fi",
      slug: "hi fi",
    });
    expect(result.success).toBe(false);
  });

  it("accepts slug with hyphens", () => {
    const result = createCategorySchema.safeParse({
      name: "HiFi Home AV",
      slug: "hifi-home-av",
    });
    expect(result.success).toBe(true);
  });
});

describe("createAttributeDefinitionSchema", () => {
  it("accepts valid attribute definition", () => {
    const result = createAttributeDefinitionSchema.safeParse({
      categoryId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      name: "Make",
      slug: "make",
      dataType: "text",
      required: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid dataType", () => {
    const result = createAttributeDefinitionSchema.safeParse({
      categoryId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      name: "Color",
      slug: "color",
      dataType: "enum",
      required: false,
    });
    expect(result.success).toBe(false);
  });
});

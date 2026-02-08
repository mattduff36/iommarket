import { z } from "zod";

export const createCategorySchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(60, "Name must be under 60 characters"),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens"),
  parentId: z.string().cuid().optional().nullable(),
  active: z.boolean().default(true),
});

export const createAttributeDefinitionSchema = z.object({
  categoryId: z.string().cuid(),
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(60, "Name too long"),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens"),
  dataType: z.enum(["text", "number", "select", "boolean"]),
  required: z.boolean().default(false),
  options: z.string().optional().nullable(), // JSON-encoded array for select type
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type CreateAttributeDefinitionInput = z.infer<
  typeof createAttributeDefinitionSchema
>;

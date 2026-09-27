import { Prisma } from "@prisma/client";
import { costDb } from "@/lib/costs/db";

export const MANUAL_COST_CATEGORY_SETTING_KEY = "cost_manual_categories";

export interface ManualCostCategory {
  slug: string;
  label: string;
}

export const DEFAULT_MANUAL_COST_CATEGORIES: readonly ManualCostCategory[] = [
  { slug: "manual-adjustment", label: "Manual Adjustment" },
  { slug: "software-subscriptions", label: "Software & Subscriptions" },
  { slug: "professional-services", label: "Professional Services" },
  { slug: "domains-licences", label: "Domains & Licences" },
  { slug: "refunds-credits", label: "Refunds & Credits" },
];

export class ManualCategoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManualCategoryError";
  }
}

export function slugifyManualCategory(label: string): string {
  const slug = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug;
}

export function parseStoredManualCategories(value: unknown): ManualCostCategory[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const slug = "slug" in item && typeof item.slug === "string" ? item.slug.trim() : "";
    const label = "label" in item && typeof item.label === "string" ? item.label.trim() : "";
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || label.length < 2) return [];
    return [{ slug, label }];
  });
}

export function mergeManualCostCategories(
  stored: readonly ManualCostCategory[],
): ManualCostCategory[] {
  const seen = new Set<string>();
  const categories: ManualCostCategory[] = [];
  for (const category of [...DEFAULT_MANUAL_COST_CATEGORIES, ...stored]) {
    const labelKey = category.label.trim().toLowerCase();
    if (seen.has(category.slug) || seen.has(labelKey)) continue;
    seen.add(category.slug);
    seen.add(labelKey);
    categories.push({ slug: category.slug, label: category.label.trim() });
  }
  return categories;
}

function uniqueSlug(label: string, categories: readonly ManualCostCategory[]): string {
  const base = slugifyManualCategory(label);
  if (base.length < 2) {
    throw new ManualCategoryError("Enter a category name with letters or numbers.");
  }
  const taken = new Set(categories.map((category) => category.slug));
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}-${suffix}`.slice(0, 60).replace(/-+$/g, "");
    if (!taken.has(candidate)) return candidate;
  }
  throw new ManualCategoryError("Choose a different category name.");
}

export async function listManualCostCategories(): Promise<ManualCostCategory[]> {
  const row = await costDb.siteSetting.findUnique({
    where: { key: MANUAL_COST_CATEGORY_SETTING_KEY },
  });
  return mergeManualCostCategories(parseStoredManualCategories(row?.value));
}

export async function createManualCostCategory(
  label: string,
): Promise<{ category: ManualCostCategory; categories: ManualCostCategory[] }> {
  const trimmed = label.trim().replace(/\s+/g, " ");
  if (trimmed.length < 2 || trimmed.length > 40) {
    throw new ManualCategoryError("Enter a category name between 2 and 40 characters.");
  }
  if (!/^[\p{L}\p{N}&'./ -]+$/u.test(trimmed)) {
    throw new ManualCategoryError("Use letters, numbers, and simple punctuation.");
  }

  const categories = await listManualCostCategories();
  if (categories.some((category) => category.label.toLowerCase() === trimmed.toLowerCase())) {
    throw new ManualCategoryError("That category already exists.");
  }

  const category = { slug: uniqueSlug(trimmed, categories), label: trimmed };
  const next = [...categories, category];
  const value = next as unknown as Prisma.InputJsonValue;
  await costDb.siteSetting.upsert({
    where: { key: MANUAL_COST_CATEGORY_SETTING_KEY },
    create: { key: MANUAL_COST_CATEGORY_SETTING_KEY, value },
    update: { value },
  });
  return { category, categories: next };
}

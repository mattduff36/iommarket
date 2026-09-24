import { marketplaceFaqCategories } from "@/lib/faq/categories-marketplace";
import { serviceFaqCategories } from "@/lib/faq/categories-services";
import { assertFaqContent } from "@/lib/faq/search";
import type { FaqCategory } from "@/lib/faq/types";

export const FAQ_CATEGORIES: readonly FaqCategory[] = [
  ...marketplaceFaqCategories,
  ...serviceFaqCategories,
];

assertFaqContent(FAQ_CATEGORIES);

import type { FaqCategory, FaqItem, FaqTextPart } from "@/lib/faq/types";

const FAQ_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeFaqQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

export function faqPartText(part: FaqTextPart): string {
  return part.kind === "text" ? part.value : part.label;
}

export function faqItemPlainText(item: FaqItem): string {
  return item.paragraphs.map((paragraph) => paragraph.map(faqPartText).join("")).join(" ");
}

export function faqSearchHaystack(category: FaqCategory, item: FaqItem): string {
  return normalizeFaqQuery(`${category.title} ${item.question} ${faqItemPlainText(item)}`);
}

export function filterFaqCategories(
  categories: readonly FaqCategory[],
  query: string,
): FaqCategory[] {
  const normalized = normalizeFaqQuery(query);
  if (!normalized) {
    return categories.map((category) => ({
      ...category,
      items: [...category.items],
    }));
  }

  return categories.flatMap((category) => {
    const items = category.items.filter((item) =>
      faqSearchHaystack(category, item).includes(normalized),
    );
    return items.length === 0 ? [] : [{ ...category, items }];
  });
}

export function countFaqItems(categories: readonly FaqCategory[]): number {
  return categories.reduce((total, category) => total + category.items.length, 0);
}

export function assertFaqContent(categories: readonly FaqCategory[]): void {
  const seen = new Set<string>();

  function claim(id: string) {
    if (!FAQ_ID_PATTERN.test(id)) {
      throw new Error(`FAQ id "${id}" must be a lowercase hyphenated slug.`);
    }
    if (seen.has(id)) {
      throw new Error(`Duplicate FAQ id "${id}".`);
    }
    seen.add(id);
  }

  for (const category of categories) {
    claim(category.id);
    if (category.items.length === 0) {
      throw new Error(`FAQ category "${category.id}" has no questions.`);
    }
    for (const item of category.items) {
      claim(item.id);
      if (!item.question.trim()) {
        throw new Error(`FAQ "${item.id}" has an empty question.`);
      }
      if (item.paragraphs.length === 0 || faqItemPlainText(item).trim().length === 0) {
        throw new Error(`FAQ "${item.id}" has an empty answer.`);
      }
    }
  }
}

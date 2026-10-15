"use client";

import * as React from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  HOME_CATEGORY_TABS,
  useHomeCategory,
  type HomeCategorySlug,
} from "@/components/marketplace/home/home-category-context";
import { SearchControls, type SearchControlsProps } from "./search/search-controls";
import styles from "./hero-search.module.css";

export interface HeroCategoryInventory {
  makes: SearchControlsProps["makes"];
  modelsByMake: SearchControlsProps["modelsByMake"];
  modelCountsByMake?: SearchControlsProps["modelCountsByMake"];
}

export interface HeroSearchProps {
  inventoryByCategory: Partial<Record<HomeCategorySlug, HeroCategoryInventory>>;
  categories?: SearchControlsProps["categories"];
  regions?: SearchControlsProps["regions"];
}

const EMPTY_INVENTORY: HeroCategoryInventory = {
  makes: [],
  modelsByMake: {},
  modelCountsByMake: {},
};

export function HeroSearch({ inventoryByCategory, categories, regions }: HeroSearchProps) {
  const sharedCategory = useHomeCategory();
  const [fallbackCategory, setFallbackCategory] = React.useState<HomeCategorySlug>("car");
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const category = sharedCategory?.category ?? fallbackCategory;
  const setCategory = sharedCategory?.setCategory ?? setFallbackCategory;
  const inventory = inventoryByCategory[category] ?? EMPTY_INVENTORY;

  return (
    <div className="mx-auto mt-8 flex w-full max-w-3xl flex-col items-center gap-4 px-2 sm:mt-10 sm:px-0">
      <div className="w-full">
        <div className={styles.tabInset}>
          <div className={styles.tabs} role="tablist" aria-label="Vehicle category">
            {HOME_CATEGORY_TABS.map((tab) => {
              const selected = category === tab.slug;
              return (
                <button
                  key={tab.slug}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  data-category={tab.slug}
                  className={cn(styles.tab, selected && styles.active, selected && styles[tab.slug])}
                  onClick={() => setCategory(tab.slug)}
                  onKeyDown={(event) => {
                    const index = HOME_CATEGORY_TABS.findIndex((item) => item.slug === category);
                    const next = event.key === "ArrowRight" ? (index + 1) % 4
                      : event.key === "ArrowLeft" ? (index + 3) % 4
                      : event.key === "Home" ? 0 : event.key === "End" ? 3 : null;
                    if (next === null) return;
                    event.preventDefault();
                    setCategory(HOME_CATEGORY_TABS[next].slug);
                    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button");
                    tabs?.[next]?.focus();
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="w-full rounded-2xl glass-surface p-4 shadow-high sm:p-6">
          <SearchControls
            makes={inventory.makes}
            modelsByMake={inventory.modelsByMake}
            modelCountsByMake={inventory.modelCountsByMake}
            categories={categories}
            regions={regions}
            mode="submit"
            category={category}
            onCategoryChange={(next) => {
              const selected = HOME_CATEGORY_TABS.find((item) => item.slug === next);
              if (selected) setCategory(selected.slug);
            }}
            advancedModalOpen={advancedOpen}
            onAdvancedModalOpenChange={setAdvancedOpen}
          />
        </div>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setAdvancedOpen(true)}
        className="rounded-full glass-surface text-metallic-400 hover:text-text-primary"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Advanced Search
      </Button>
    </div>
  );
}

"use client";

import * as React from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchControls, type SearchControlsProps } from "./search/search-controls";

export interface HeroSearchProps {
  makes: SearchControlsProps["makes"];
  modelsByMake: SearchControlsProps["modelsByMake"];
  categories?: SearchControlsProps["categories"];
  regions?: SearchControlsProps["regions"];
}

export function HeroSearch({ makes, modelsByMake, categories, regions }: HeroSearchProps) {
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  return (
    <div className="mx-auto mt-8 sm:mt-10 flex flex-col items-center gap-4 w-full max-w-3xl px-2 sm:px-0">
      <div className="w-full sm:w-auto rounded-2xl glass-surface p-4 sm:p-6 shadow-high">
        <SearchControls
          makes={makes}
          modelsByMake={modelsByMake}
          categories={categories}
          regions={regions}
          mode="submit"
          advancedModalOpen={advancedOpen}
          onAdvancedModalOpenChange={setAdvancedOpen}
        />
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

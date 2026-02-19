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
    <div className="mx-auto mt-10 flex flex-col items-center gap-4">
      <div className="inline-block rounded-2xl border border-white/20 bg-white/95 p-5 shadow-2xl backdrop-blur-md sm:p-6">
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
        variant="secondary"
        size="sm"
        onClick={() => setAdvancedOpen(true)}
        className="rounded-full border border-white/25 bg-white/90 text-slate-600 shadow backdrop-blur-sm hover:bg-white hover:text-slate-900"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Advanced Search
      </Button>
    </div>
  );
}

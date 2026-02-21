"use client";

import { useTransition } from "react";
import { saveSearch } from "@/actions/user-tools";
import { Button } from "@/components/ui/button";

interface Props {
  queryParams: Record<string, string>;
}

export function SaveSearchButton({ queryParams }: Props) {
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    const name = window.prompt("Name this saved search");
    if (!name) return;
    startTransition(async () => {
      await saveSearch({
        name,
        queryParamsJson: queryParams,
      });
    });
  }

  return (
    <Button type="button" variant="ghost" size="sm" onClick={handleSave} disabled={isPending}>
      {isPending ? "Saving..." : "Save search"}
    </Button>
  );
}

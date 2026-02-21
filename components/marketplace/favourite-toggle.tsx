"use client";

import { useState, useTransition } from "react";
import { Heart } from "lucide-react";
import { toggleFavourite } from "@/actions/user-tools";
import { Button } from "@/components/ui/button";

interface Props {
  listingId: string;
  initialIsFavourite: boolean;
}

export function FavouriteToggle({ listingId, initialIsFavourite }: Props) {
  const [isFavourite, setIsFavourite] = useState(initialIsFavourite);
  const [isPending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const result = await toggleFavourite({ listingId });
      if (result.data) {
        setIsFavourite(result.data.isFavourite);
      }
    });
  }

  return (
    <Button
      type="button"
      variant={isFavourite ? "energy" : "ghost"}
      size="sm"
      disabled={isPending}
      onClick={onClick}
      className="w-full"
    >
      <Heart className={`h-4 w-4 ${isFavourite ? "fill-current" : ""}`} />
      {isFavourite ? "Saved" : "Save"}
    </Button>
  );
}

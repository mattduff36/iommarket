"use client";

import { useState, useTransition } from "react";
import { Heart } from "lucide-react";
import { toggleFavourite } from "@/actions/user-tools";
import { Button } from "@/components/ui/button";

interface Props {
  listingId: string;
  initialIsFavourite: boolean;
  compact?: boolean;
}

export function FavouriteToggle({
  listingId,
  initialIsFavourite,
  compact = false,
}: Props) {
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
      size={compact ? "icon" : "sm"}
      disabled={isPending}
      onClick={onClick}
      className={compact ? "h-9 w-9 rounded-full backdrop-blur-sm" : "w-full"}
      aria-label={isFavourite ? "Remove from favourites" : "Save to favourites"}
    >
      <Heart className={`h-4 w-4 ${isFavourite ? "fill-current" : ""}`} />
      {!compact ? (isFavourite ? "Saved" : "Save") : null}
    </Button>
  );
}

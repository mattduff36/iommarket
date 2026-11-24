import type { ReactNode } from "react";
import { ImageIcon } from "lucide-react";
import { ListingPhoto } from "@/components/marketplace/listing-photo";
import { toListingPhotoSource } from "@/lib/images/photo";

export function ListingTableTitle({ image, children }: {
  image: Parameters<typeof toListingPhotoSource>[0];
  children: ReactNode;
}) {
  const photo = toListingPhotoSource(image);
  return (
    <div className="listing-table-title">
      <div className="listing-table-thumbnail">
        {photo ? (
          <ListingPhoto photo={photo} frame="thumb" alt="" sizes="(max-width: 820px) 80px, 48px" fillContainer />
        ) : <ImageIcon aria-hidden="true" className="size-4 text-text-tertiary" />}
      </div>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

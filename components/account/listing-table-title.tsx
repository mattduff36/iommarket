import Link from "@/components/navigation/link";
import { ImageIcon } from "lucide-react";
import { ListingPhoto } from "@/components/marketplace/listing-photo";
import { toListingPhotoSource } from "@/lib/images/photo";

export function ListingTableTitle({ listingId, image, children }: {
  image: Parameters<typeof toListingPhotoSource>[0];
  listingId: string;
  children: string;
}) {
  const photo = toListingPhotoSource(image);
  return (
    <div className="listing-table-title">
      <div className="listing-table-thumbnail">
        {photo ? (
          <ListingPhoto photo={photo} frame="thumb" alt="" sizes="(max-width: 820px) 160px, 48px" fillContainer />
        ) : <ImageIcon aria-hidden="true" className="size-4 text-text-tertiary" />}
      </div>
      <Link href={`/listings/${listingId}`} className="min-w-0 hover:underline focus-visible:underline">
        {children}
      </Link>
    </div>
  );
}

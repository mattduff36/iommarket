export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { Images } from "lucide-react";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import {
  AdminFilterBar,
  AdminFilterChip,
} from "@/components/admin/admin-filter-bar";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminPager } from "@/components/admin/admin-pager";
import { ListingPhoto } from "@/components/marketplace/listing-photo";
import { toListingPhotoSource } from "@/lib/images/photo";
import {
  CARD_OVERLAY_CONTROL_CLASS,
  CardOverlayLink,
} from "@/components/ui/card-overlay-link";
import { DeleteImageButton } from "./delete-image-button";
import type { Prisma } from "@prisma/client";

export const metadata: Metadata = { title: "Media | Admin" };

interface Props {
  searchParams: Promise<{
    filter?: string;
    page?: string;
  }>;
}

const PAGE_SIZE = 30;

const STATUS_BADGE: Record<string, "success" | "warning" | "error" | "neutral"> = {
  LIVE: "success",
  PENDING: "warning",
  DRAFT: "neutral",
  APPROVED: "success",
  EXPIRED: "error",
  TAKEN_DOWN: "error",
  SOLD: "neutral",
};

export default async function AdminMediaPage({ searchParams }: Props) {
  const params = await searchParams;
  const filter = params.filter;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  const where: Prisma.ListingImageWhereInput = filter === "orphan"
    ? { listing: { status: { in: ["TAKEN_DOWN", "EXPIRED"] } } }
    : {};

  const [images, total] = await Promise.all([
    db.listingImage.findMany({
      where,
      orderBy: { listing: { createdAt: "desc" } },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            status: true,
            user: { select: { email: true } },
            dealer: { select: { name: true } },
          },
        },
      },
    }),
    db.listingImage.count({ where }),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <>
      <AdminPageHeader
        title="Media library"
        description="Review listing images and remove assets that should no longer remain attached to a listing."
      />

      <AdminFilterBar count={`${total} ${total === 1 ? "image" : "images"}`}>
        <AdminFilterChip
          href="/admin/media"
          active={!filter}
        >
          All images
        </AdminFilterChip>
        <AdminFilterChip
          href="/admin/media?filter=orphan"
          active={filter === "orphan"}
          activeTone="warning"
        >
          Orphaned (expired/taken down)
        </AdminFilterChip>
      </AdminFilterBar>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5">
        {images.map((img) => (
          <article key={img.id} className="relative overflow-hidden rounded-lg border border-border bg-surface shadow-low">
            <CardOverlayLink
              href={`/listings/${img.listing.id}`}
              label={img.listing.title}
            />
            <div className="relative aspect-square bg-graphite-800">
              <ListingPhoto
                photo={toListingPhotoSource(img)!}
                frame="admin"
                alt={img.listing.title}
                fillContainer
                sizes="(max-width: 768px) 50vw, 200px"
              />
            </div>
            <div className="p-2 space-y-1">
              <p className="line-clamp-1 text-xs text-text-primary">{img.listing.title}</p>
              <div className="flex items-center gap-1">
                <Badge variant={STATUS_BADGE[img.listing.status] ?? "neutral"} className="text-[10px]">
                  {img.listing.status}
                </Badge>
              </div>
              <p className="text-[10px] text-text-tertiary truncate">
                {img.listing.dealer?.name ?? img.listing.user.email}
              </p>
              <div className={CARD_OVERLAY_CONTROL_CLASS}>
                <DeleteImageButton imageId={img.id} listingTitle={img.listing.title} />
              </div>
            </div>
          </article>
        ))}
      </div>

      {images.length === 0 && (
        <AdminEmptyState
          icon={Images}
          title={filter === "orphan" ? "No orphaned images" : "No images found"}
          description={
            filter === "orphan"
              ? "Expired and taken-down listings do not currently have images to review."
              : "Listing images will appear here when they are uploaded."
          }
        />
      )}

      <AdminPager
        page={page}
        totalPages={totalPages}
        hrefForPage={(nextPage) =>
          `/admin/media?${filter ? `filter=${filter}&` : ""}page=${nextPage}`
        }
      />
    </>
  );
}

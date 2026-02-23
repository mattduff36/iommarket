export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
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
      <h1 className="text-2xl font-bold text-text-primary mb-6">Media Library</h1>

      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/admin/media"
          className={`h-9 inline-flex items-center px-3 rounded-md text-xs font-medium border transition-colors ${
            !filter ? "bg-surface-elevated text-text-primary border-border" : "text-text-secondary border-transparent hover:bg-surface-elevated"
          }`}
        >
          All Images
        </Link>
        <Link
          href="/admin/media?filter=orphan"
          className={`h-9 inline-flex items-center px-3 rounded-md text-xs font-medium border transition-colors ${
            filter === "orphan" ? "bg-neon-red-500/10 text-neon-red-400 border-neon-red-500/30" : "text-text-secondary border-transparent hover:bg-surface-elevated"
          }`}
        >
          Orphaned (expired/taken down)
        </Link>
        <span className="text-xs text-text-tertiary ml-auto">{total} images</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {images.map((img) => (
          <div key={img.id} className="rounded-lg border border-border bg-surface overflow-hidden">
            <div className="relative aspect-square bg-graphite-800">
              <Image
                src={img.url}
                alt={img.listing.title}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 50vw, 200px"
              />
            </div>
            <div className="p-2 space-y-1">
              <Link
                href={`/listings/${img.listing.id}`}
                className="text-xs text-text-primary hover:underline line-clamp-1"
              >
                {img.listing.title}
              </Link>
              <div className="flex items-center gap-1">
                <Badge variant={STATUS_BADGE[img.listing.status] ?? "neutral"} className="text-[10px]">
                  {img.listing.status}
                </Badge>
              </div>
              <p className="text-[10px] text-text-tertiary truncate">
                {img.listing.dealer?.name ?? img.listing.user.email}
              </p>
              <DeleteImageButton imageId={img.id} />
            </div>
          </div>
        ))}
      </div>

      {images.length === 0 && (
        <p className="text-center text-text-tertiary py-12">No images found.</p>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          {page > 1 && (
            <Link
              href={`/admin/media?${filter ? `filter=${filter}&` : ""}page=${page - 1}`}
              className="h-9 px-3 rounded-md text-sm font-medium text-text-secondary hover:bg-surface-elevated border border-border"
            >
              Previous
            </Link>
          )}
          <span className="text-sm text-text-tertiary">Page {page} of {totalPages}</span>
          {page < totalPages && (
            <Link
              href={`/admin/media?${filter ? `filter=${filter}&` : ""}page=${page + 1}`}
              className="h-9 px-3 rounded-md text-sm font-medium text-text-secondary hover:bg-surface-elevated border border-border"
            >
              Next
            </Link>
          )}
        </div>
      )}
    </>
  );
}

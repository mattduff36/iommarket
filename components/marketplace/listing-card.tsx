"use client";

import * as React from "react";
import Image from "next/image";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { MapPin } from "lucide-react";

export interface ListingCardProps extends React.HTMLAttributes<HTMLElement> {
  title: string;
  price: number;
  currency?: string;
  imageSrc?: string;
  imageAlt?: string;
  location?: string;
  meta?: string;
  featured?: boolean;
  badge?: string;
  href?: string;
}

function formatPrice(price: number, currency = "£"): string {
  return Number.isInteger(price)
    ? `${currency}${price.toLocaleString()}`
    : `${currency}${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const ListingCard = React.forwardRef<HTMLElement, ListingCardProps>(
  (
    {
      title,
      price,
      currency = "£",
      imageSrc,
      imageAlt,
      location,
      meta,
      featured = false,
      badge,
      href,
      className,
      ...props
    },
    ref,
  ) => {
    const titleId = React.useId();

    const card = (
      <article
        ref={ref}
        role="article"
        aria-labelledby={titleId}
        className={cn(
          "group flex flex-col overflow-hidden rounded-lg border border-border bg-surface transition-shadow",
          "hover:shadow-md focus-within:shadow-outline",
          featured && "ring-2 ring-royal-500",
          className,
        )}
        {...props}
      >
        {/* Image */}
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-surface-subtle">
          {imageSrc ? (
            <Image
              src={imageSrc}
              alt={imageAlt ?? title}
              fill
              className="object-cover transition-transform group-hover:scale-105"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-text-tertiary">
              <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          )}
          {badge && (
            <div className="absolute top-2 left-2">
              <Badge variant="success">{badge}</Badge>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex flex-1 flex-col gap-2 p-4">
          <h3
            id={titleId}
            className="text-base font-semibold text-text-primary line-clamp-2"
          >
            {href ? (
              <a href={href} className="hover:text-text-brand focus:outline-none">
                <span className="absolute inset-0" aria-hidden="true" />
                {title}
              </a>
            ) : (
              title
            )}
          </h3>

          <p className="text-lg font-bold text-text-primary">
            {formatPrice(price, currency)}
          </p>

          {(location || meta) && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
              {location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {location}
                </span>
              )}
              {meta && <span>{meta}</span>}
            </div>
          )}
        </div>
      </article>
    );

    return card;
  },
);
ListingCard.displayName = "ListingCard";

export { ListingCard };

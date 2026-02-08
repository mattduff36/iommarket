"use client";

import * as React from "react";
import Image from "next/image";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";

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
          "group relative flex flex-col overflow-hidden rounded-xl border border-slate-100 bg-white",
          "transition-all duration-200 hover:shadow-lift hover:-translate-y-1",
          featured && "ring-2 ring-royal-500",
          className,
        )}
        {...props}
      >
        {/* Image */}
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-50">
          {imageSrc ? (
            <Image
              src={imageSrc}
              alt={imageAlt ?? title}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-300">
              <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          )}
          {badge && (
            <div className="absolute top-3 left-3">
              <Badge variant="success">{badge}</Badge>
            </div>
          )}
        </div>

        {/* Content — centered like ToyStore */}
        <div className="flex flex-1 flex-col items-center gap-2 px-4 py-5">
          <h3
            id={titleId}
            className="text-base font-semibold text-slate-900 text-center line-clamp-2 leading-snug"
          >
            {href ? (
              <a href={href} className="hover:text-royal-700 focus:outline-none">
                <span className="absolute inset-0" aria-hidden="true" />
                {title}
              </a>
            ) : (
              title
            )}
          </h3>

          <Badge variant="price">
            {formatPrice(price, currency)}
          </Badge>

          {(location || meta) && (
            <p className="text-xs text-slate-400 text-center mt-1">
              {[location, meta].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      </article>
    );

    return card;
  },
);
ListingCard.displayName = "ListingCard";

export { ListingCard };

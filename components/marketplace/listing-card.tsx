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
  sold?: boolean;
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
    sold = false,
    href,
      className,
      ...props
    },
    ref,
  ) => {
    const titleId = React.useId();

    return (
      <article
        ref={ref}
        role="article"
        aria-labelledby={titleId}
        className={cn(
          "group relative flex flex-col overflow-hidden rounded-lg",
          "border border-border bg-surface",
          "transition-all duration-fast ease-fast",
          "hover:border-metallic-400 hover:-translate-y-0.5 hover:shadow-high",
          featured && "ring-2 ring-neon-blue-500",
          className,
        )}
        {...props}
      >
        {/* Image container with overlay gradient */}
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-graphite-800">
          {imageSrc ? (
            <Image
              src={imageSrc}
              alt={imageAlt ?? title}
              fill
              className={`object-cover transition-transform duration-fast group-hover:scale-[1.02]${sold ? " brightness-75" : ""}`}
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-metallic-500">
              <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          )}
          {/* Bottom gradient overlay */}
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-surface to-transparent" />
          {sold && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="rotate-[-15deg] text-lg sm:text-xl font-black tracking-widest text-white opacity-95 drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)] border-4 border-white px-3 py-1 rounded-sm">
                SOLD
              </span>
            </div>
          )}
          {!sold && badge && (
            <div className="absolute top-3 left-3">
              <Badge variant="energy">{badge}</Badge>
            </div>
          )}
          {sold && (
            <div className="absolute top-3 left-3">
              <Badge variant="success">Sold</Badge>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex flex-1 flex-col items-center gap-1.5 sm:gap-2 px-2.5 py-3 sm:px-4 sm:py-5">
          <h3
            id={titleId}
            className="text-sm sm:text-base font-semibold text-text-primary text-center line-clamp-2 leading-snug"
          >
            {href ? (
              <a href={href} className="hover:text-text-trust focus:outline-none">
                <span className="absolute inset-0" aria-hidden="true" />
                {title}
              </a>
            ) : (
              title
            )}
          </h3>

          <span className="text-base sm:text-lg font-extrabold text-text-energy">
            {formatPrice(price, currency)}
          </span>

          {(location || meta) && (
            <p className="text-xs text-text-secondary text-center mt-1">
              {[location, meta].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      </article>
    );
  },
);
ListingCard.displayName = "ListingCard";

export { ListingCard };

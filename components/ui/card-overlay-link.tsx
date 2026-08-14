import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export const NAVIGABLE_CARD_LINK_CLASS =
  "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neon-blue-500";

export const CARD_OVERLAY_CONTROL_CLASS = "relative z-20";

type CardOverlayLinkProps = {
  href: ComponentProps<typeof Link>["href"];
  label: string;
  className?: string;
  target?: string;
  rel?: string;
};

export function CardOverlayLink({
  href,
  label,
  className,
  target,
  rel,
}: CardOverlayLinkProps) {
  return (
    <Link
      href={href}
      aria-label={label}
      target={target}
      rel={rel}
      className={cn(
        "absolute inset-0 z-10 rounded-[inherit]",
        NAVIGABLE_CARD_LINK_CLASS,
        className,
      )}
    />
  );
}

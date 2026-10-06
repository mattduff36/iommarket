import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const adminRecordLinkClass =
  "text-text-primary hover:underline focus-visible:underline";

export function AdminRecordLink({
  href,
  children,
  external = false,
  className,
}: {
  href: string;
  children: ReactNode;
  external?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      prefetch={external ? false : undefined}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className={cn(adminRecordLinkClass, className)}
    >
      {children}
      {external ? <span className="sr-only">. Opens in a new tab</span> : null}
    </Link>
  );
}

import Link from "next/link";
import { ChevronRight } from "lucide-react";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  return (
    <nav className={className ?? "mb-6 sm:mb-8 text-sm text-metallic-400 overflow-hidden"} aria-label="Breadcrumb">
      <ol className="flex items-center gap-1 min-w-0">
        <li className="shrink-0">
          <Link href="/" className="hover:text-text-primary transition-colors">
            Home
          </Link>
        </li>
        {items.map((item) => (
          <li key={`${item.href ?? "current"}-${item.label}`} className="flex min-w-0 items-center gap-1">
            <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
            {item.href ? (
              <Link href={item.href} className="shrink-0 hover:text-text-primary transition-colors">
                {item.label}
              </Link>
            ) : (
              <span className="truncate font-medium text-text-primary">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

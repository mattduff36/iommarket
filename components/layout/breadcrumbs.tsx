import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { JsonLd } from "@/components/seo/json-ld";
import {
  buildBreadcrumbListJsonLd,
  type BreadcrumbEntry,
} from "@/lib/seo/structured-data";

export type BreadcrumbItem = BreadcrumbEntry;

interface BreadcrumbsProps {
  items: readonly BreadcrumbItem[];
  className?: string;
  structuredData?: boolean;
}

const HOME_CRUMB: BreadcrumbItem = { label: "Home", href: "/" };

export function Breadcrumbs({
  items,
  className,
  structuredData = true,
}: BreadcrumbsProps) {
  if (items.length === 0) return null;

  const trail = [HOME_CRUMB, ...items];

  return (
    <>
      <nav
        className={
          className ??
          "mb-6 overflow-hidden text-sm text-metallic-400 sm:mb-8"
        }
        aria-label="Breadcrumb"
      >
        <ol className="flex w-full min-w-0 items-center gap-1">
          {trail.map((item, index) => {
            const isCurrent = index === trail.length - 1;

            return (
              <li
                key={`${item.href}-${item.label}`}
                className={
                  index === 0
                    ? "flex shrink-0 items-center gap-1"
                    : isCurrent
                      ? "flex min-w-[5rem] flex-1 items-center gap-1"
                      : "flex min-w-0 max-w-[35vw] shrink items-center gap-1 sm:max-w-56"
                }
              >
                {index > 0 ? (
                  <ChevronRight
                    className="h-3 w-3 shrink-0"
                    aria-hidden="true"
                  />
                ) : null}
                {isCurrent ? (
                  <span
                    aria-current="page"
                    className="truncate font-medium text-text-primary"
                  >
                    {item.label}
                  </span>
                ) : (
                  <Link
                    href={item.href}
                    className="min-w-0 truncate transition-colors hover:text-text-primary focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500"
                  >
                    {item.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      {structuredData ? (
        <JsonLd data={buildBreadcrumbListJsonLd(trail)} />
      ) : null}
    </>
  );
}

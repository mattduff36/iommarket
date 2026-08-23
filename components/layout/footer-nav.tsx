"use client";

import Link from "next/link";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { sameLineSeparatorVisibility } from "@/lib/footer-nav-separators";

type FooterNavItem = {
  href: string;
  label: string;
};

function readLineStarts(elements: Array<HTMLElement | null>): number[] {
  return elements.map((element) => element?.getBoundingClientRect().top ?? 0);
}

export function FooterNav({
  items,
  className,
}: {
  items: FooterNavItem[];
  className?: string;
}) {
  const navRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const [visibleSeparators, setVisibleSeparators] = useState<boolean[]>(() =>
    items.slice(1).map(() => false),
  );

  const updateSeparators = useCallback(() => {
    setVisibleSeparators(
      sameLineSeparatorVisibility(readLineStarts(itemRefs.current)),
    );
  }, []);

  useLayoutEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, items.length);

    let cancelled = false;
    const update = () => {
      if (!cancelled) {
        updateSeparators();
      }
    };

    update();

    const nav = navRef.current;
    if (!nav) {
      return () => {
        cancelled = true;
      };
    }

    const observer = new ResizeObserver(update);
    observer.observe(nav);
    window.addEventListener("resize", update);
    void document.fonts?.ready.then(update);

    return () => {
      cancelled = true;
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [items.length, updateSeparators]);

  return (
    <nav
      ref={navRef}
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-4 gap-y-0 text-center text-sm leading-snug",
        className,
      )}
      aria-label="Footer"
    >
      {items.map((item, index) => (
        <span key={item.href} className="relative">
          {index > 0 ? (
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute top-1/2 -left-2 -translate-x-1/2 -translate-y-1/2 text-metallic-500 ${
                visibleSeparators[index - 1] ? "opacity-100" : "opacity-0"
              }`}
            >
              ·
            </span>
          ) : null}
          <Link
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            href={item.href}
            className="text-metallic-400 hover:text-text-primary transition-colors"
          >
            {item.label}
          </Link>
        </span>
      ))}
    </nav>
  );
}

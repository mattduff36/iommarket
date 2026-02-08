"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, type ButtonProps } from "./button";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

function Pagination({ currentPage, totalPages, onPageChange, className }: PaginationProps) {
  const pages = React.useMemo(() => {
    const items: (number | "ellipsis")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) items.push(i);
    } else {
      items.push(1);
      if (currentPage > 3) items.push("ellipsis");
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      for (let i = start; i <= end; i++) items.push(i);
      if (currentPage < totalPages - 2) items.push("ellipsis");
      items.push(totalPages);
    }
    return items;
  }, [currentPage, totalPages]);

  return (
    <nav
      role="navigation"
      aria-label="Pagination"
      className={cn("flex items-center gap-1", className)}
    >
      <PaginationButton
        variant="secondary"
        size="icon"
        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        disabled={currentPage === 1}
        aria-label="Previous page"
      >
        <ChevronLeft className="h-4 w-4" />
      </PaginationButton>

      {pages.map((page, i) =>
        page === "ellipsis" ? (
          <span key={`e-${i}`} className="flex h-10 w-10 items-center justify-center text-text-secondary">
            <MoreHorizontal className="h-4 w-4" />
          </span>
        ) : (
          <PaginationButton
            key={page}
            variant={page === currentPage ? "primary" : "secondary"}
            size="icon"
            onClick={() => onPageChange(page)}
            aria-label={`Page ${page}`}
            aria-current={page === currentPage ? "page" : undefined}
          >
            {page}
          </PaginationButton>
        ),
      )}

      <PaginationButton
        variant="secondary"
        size="icon"
        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        disabled={currentPage === totalPages}
        aria-label="Next page"
      >
        <ChevronRight className="h-4 w-4" />
      </PaginationButton>
    </nav>
  );
}

function PaginationButton(props: ButtonProps) {
  return <Button {...props} />;
}

export { Pagination };

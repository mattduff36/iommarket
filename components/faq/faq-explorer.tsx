"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  countFaqItems,
  filterFaqCategories,
  normalizeFaqQuery,
} from "@/lib/faq/search";
import type { FaqCategory, FaqTextPart } from "@/lib/faq/types";

const anchorClassName = "scroll-mt-24 sm:scroll-mt-28";

const linkClassName = [
  "text-text-trust underline decoration-text-trust/40 underline-offset-2",
  "hover:decoration-text-trust",
  "focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2",
  "focus-visible:ring-neon-blue-500",
].join(" ");

function samePageFaqHash(href: string): string | null {
  if (href.startsWith("#")) return href;
  if (href.startsWith("/faq#")) return href.slice("/faq".length);
  return null;
}

function revealFaqHash(id: string): "opened" | "present" | "missing" {
  const element = document.getElementById(id);
  if (!element) return "missing";
  if (!(element instanceof HTMLDetailsElement)) return "present";
  element.open = true;
  if (typeof element.scrollIntoView === "function") {
    element.scrollIntoView({ block: "start" });
  }
  return "opened";
}

function FaqAnswerPart({
  part,
  onMissingHash,
}: {
  part: FaqTextPart;
  onMissingHash: (id: string) => void;
}) {
  if (part.kind === "text") return <>{part.value}</>;
  const hash = samePageFaqHash(part.href);
  if (!hash && part.href.startsWith("/")) {
    return (
      <Link href={part.href} className={linkClassName}>
        {part.label}
      </Link>
    );
  }
  return (
    <a
      href={hash ?? part.href}
      className={linkClassName}
      onClick={(event) => {
        if (!hash) return;
        const id = hash.slice(1);
        if (!id || revealFaqHash(id) !== "missing") return;
        event.preventDefault();
        if (window.location.hash !== hash) {
          window.history.replaceState(null, "", hash);
        }
        onMissingHash(id);
      }}
    >
      {part.label}
    </a>
  );
}

interface FaqExplorerProps {
  categories: readonly FaqCategory[];
}

export function FaqExplorer({ categories }: FaqExplorerProps) {
  const [query, setQuery] = useState("");
  const pendingHash = useRef<string | null>(null);
  const searchId = useId();
  const normalizedQuery = normalizeFaqQuery(query);
  const visibleCategories = filterFaqCategories(categories, query);
  const matchCount = countFaqItems(visibleCategories);

  useEffect(() => {
    function openFromHash() {
      const id = window.location.hash.replace(/^#/, "");
      if (!id || revealFaqHash(id) !== "missing") return;
      pendingHash.current = id;
      setQuery("");
    }

    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);

  useEffect(() => {
    const id = pendingHash.current;
    if (!id || revealFaqHash(id) === "missing") return;
    pendingHash.current = null;
  }, [visibleCategories]);

  function showMissingFaqTarget(id: string) {
    pendingHash.current = id;
    setQuery("");
  }

  function rememberOpenQuestion(event: React.ToggleEvent<HTMLDetailsElement>) {
    if (!event.currentTarget.open) return;
    const nextHash = `#${event.currentTarget.id}`;
    if (window.location.hash === nextHash) return;
    window.history.replaceState(null, "", nextHash);
  }

  return (
    <div>
      <form
        role="search"
        className="mt-8"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Input
              id={searchId}
              label="Search FAQs"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Try price, dealer, sold, photos or refund"
              autoComplete="off"
            />
          </div>
          {normalizedQuery ? (
            <Button
              type="button"
              variant="ghost"
              size="md"
              className="border border-border"
              onClick={() => setQuery("")}
            >
              Clear search
            </Button>
          ) : null}
        </div>
      </form>

      <nav aria-label="FAQ categories" className="mt-6">
        <ul className="flex flex-wrap gap-2">
          {visibleCategories.map((category) => (
            <li key={category.id}>
              <a
                href={`#${category.id}`}
                className={[
                  "inline-flex min-h-10 items-center rounded-sm border border-border",
                  "bg-surface px-3 py-2 text-sm text-text-secondary",
                  "hover:text-text-primary",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500",
                ].join(" ")}
              >
                {category.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <p className="mt-4 text-sm text-text-secondary" aria-live="polite">
        {normalizedQuery
          ? matchCount === 0
            ? "No questions match that search."
            : `${matchCount} matching ${matchCount === 1 ? "question" : "questions"}.`
          : "Search matches the question, the answer and the category."}
      </p>

      {matchCount === 0 ? (
        <div className="mt-6 rounded-lg border border-border bg-surface px-4 py-6">
          <p className="text-sm leading-6 text-text-secondary">
            Nothing matched “{normalizedQuery}”. Try a different word, or clear the search to see every question.
          </p>
          <Button
            type="button"
            variant="trust"
            size="sm"
            className="mt-4"
            onClick={() => setQuery("")}
          >
            Clear search
          </Button>
        </div>
      ) : (
        <div className="mt-8 space-y-10">
          {visibleCategories.map((category) => (
            <section key={category.id} aria-labelledby={category.id}>
              <h2
                id={category.id}
                className={`${anchorClassName} text-xl font-bold text-text-primary font-heading sm:text-2xl`}
              >
                {category.title}
              </h2>
              <div className="mt-3 border-t border-border">
                {category.items.map((item) => (
                  <details
                    key={item.id}
                    id={item.id}
                    className={`${anchorClassName} group border-b border-border`}
                    onToggle={rememberOpenQuestion}
                  >
                    <summary
                      className={[
                        "flex min-h-12 cursor-pointer list-none items-start justify-between gap-3 py-4",
                        "text-base font-medium text-text-primary",
                        "focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2",
                        "focus-visible:ring-neon-blue-500",
                        "[&::-webkit-details-marker]:hidden",
                      ].join(" ")}
                    >
                      <span className="min-w-0 flex-1 text-left break-words">
                        {item.question}
                      </span>
                      <ChevronDown
                        className="mt-1 h-4 w-4 shrink-0 text-metallic-400 transition-transform group-open:rotate-180"
                        aria-hidden="true"
                      />
                    </summary>
                    <div className="space-y-3 pb-4 pr-7 text-sm leading-6 text-text-secondary">
                      {item.paragraphs.map((paragraph, index) => (
                        <p key={`${item.id}-${index}`}>
                          {paragraph.map((part, partIndex) => (
                            <FaqAnswerPart
                              key={`${item.id}-${index}-${partIndex}`}
                              part={part}
                              onMissingHash={showMissingFaqTarget}
                            />
                          ))}
                        </p>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

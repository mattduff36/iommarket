"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

interface ExpandableDescriptionProps {
  description: string;
  collapsedHeightClassName?: string;
}

const DEFAULT_COLLAPSE_THRESHOLD = 420;

export function ExpandableDescription({
  description,
  collapsedHeightClassName = "max-h-44",
}: ExpandableDescriptionProps) {
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse = useMemo(
    () => description.trim().length > DEFAULT_COLLAPSE_THRESHOLD,
    [description]
  );

  return (
    <div>
      <div
        className={`relative whitespace-pre-line text-sm text-text-secondary leading-relaxed ${
          shouldCollapse && !expanded ? `${collapsedHeightClassName} overflow-hidden` : ""
        }`}
      >
        {description}
        {shouldCollapse && !expanded ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-canvas to-transparent" />
        ) : null}
      </div>

      {shouldCollapse ? (
        <div className="mt-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setExpanded((prev) => !prev)}
            className="px-0"
          >
            {expanded ? "Show less" : "Show full description"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

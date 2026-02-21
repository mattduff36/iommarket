"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export interface SearchBarProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value?: string;
  onValueChange?: (value: string) => void;
  onSearch?: (value: string) => void;
}

const SearchBar = React.forwardRef<HTMLInputElement, SearchBarProps>(
  ({ className, value: controlledValue, onValueChange, onSearch, ...props }, ref) => {
    const [internalValue, setInternalValue] = React.useState("");
    const value = controlledValue ?? internalValue;

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      const v = e.target.value;
      setInternalValue(v);
      onValueChange?.(v);
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
      if (e.key === "Enter") {
        onSearch?.(value);
      }
    }

    function handleClear() {
      setInternalValue("");
      onValueChange?.("");
    }

    return (
      <div className={cn("relative flex items-center", className)}>
        <Search className="absolute left-3 h-4 w-4 text-text-tertiary pointer-events-none" />
        <input
          ref={ref}
          type="search"
          role="searchbox"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          className={cn(
            "flex h-10 w-full rounded-sm border border-border bg-surface-elevated pl-9 pr-9 text-sm text-text-primary",
            "placeholder:text-text-secondary",
            "focus:outline-none focus:border-neon-blue-500 focus:shadow-glow-blue",
          )}
          {...props}
        />
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleClear}
            className="absolute right-1 h-8 w-8 text-text-tertiary hover:text-text-secondary"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  },
);
SearchBar.displayName = "SearchBar";

export { SearchBar };

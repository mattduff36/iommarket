"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
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
            "flex h-10 w-full rounded-md border border-border bg-surface pl-9 pr-9 text-sm text-text-primary",
            "placeholder:text-text-tertiary",
            "focus:outline-none focus:border-border-focus focus:shadow-outline",
          )}
          {...props}
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 text-text-tertiary hover:text-text-secondary focus:outline-none"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  },
);
SearchBar.displayName = "SearchBar";

export { SearchBar };

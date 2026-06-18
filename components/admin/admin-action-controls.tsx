"use client";

import type {
  ButtonHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

interface AdminActionBarProps {
  children: ReactNode;
  className?: string;
  label?: string;
}

interface AdminActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: "neutral" | "primary" | "success" | "warning" | "danger";
}

interface AdminSegmentedControlOption<TValue extends string> {
  value: TValue;
  label: string;
}

interface AdminSegmentedControlProps<TValue extends string> {
  label: string;
  value: TValue;
  options: Array<AdminSegmentedControlOption<TValue>>;
  onChange: (value: TValue) => void;
  disabled?: boolean;
  className?: string;
}

const actionButtonTone = {
  neutral:
    "border-border bg-surface text-text-secondary hover:border-border-focus hover:bg-surface-elevated hover:text-text-primary",
  primary:
    "border-neon-blue-500/25 bg-neon-blue-500/10 text-neon-blue-400 hover:border-neon-blue-500/45 hover:bg-neon-blue-500/15 hover:text-neon-blue-500",
  success:
    "border-emerald-500/25 bg-emerald-500/10 text-emerald-500 hover:border-emerald-500/45 hover:bg-emerald-500/15",
  warning:
    "border-premium-gold-500/25 bg-premium-gold-500/10 text-premium-gold-400 hover:border-premium-gold-500/45 hover:bg-premium-gold-500/15 hover:text-premium-gold-500",
  danger:
    "border-neon-red-500/25 bg-neon-red-500/5 text-neon-red-400 hover:border-neon-red-500/45 hover:bg-neon-red-500/10 hover:text-neon-red-500",
};

export function AdminActionBar({ children, className, label = "Admin actions" }: AdminActionBarProps) {
  return (
    <div
      aria-label={label}
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      {children}
    </div>
  );
}

export function AdminActionButton({
  className,
  tone = "neutral",
  type = "button",
  ...props
}: AdminActionButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex h-8 items-center justify-center rounded-md border px-3 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        "disabled:cursor-not-allowed disabled:opacity-50",
        actionButtonTone[tone],
        className,
      )}
      {...props}
    />
  );
}

export function AdminSegmentedControl<TValue extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  className,
}: AdminSegmentedControlProps<TValue>) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
        {label}
      </span>
      <div className="inline-flex rounded-lg border border-border bg-canvas/40 p-0.5">
        {options.map((option) => {
          const isSelected = option.value === value;

          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isSelected}
              disabled={disabled || isSelected}
              onClick={() => onChange(option.value)}
              className={cn(
                "h-7 rounded-md px-2.5 text-[11px] font-semibold uppercase tracking-wide transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500",
                isSelected
                  ? "bg-surface-elevated text-text-primary shadow-sm"
                  : "text-text-tertiary hover:bg-surface hover:text-text-primary",
                "disabled:cursor-default disabled:opacity-100",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AdminActionSelect({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-9 rounded-md border border-border bg-surface px-3 text-xs text-text-primary",
        "focus:outline-none focus:border-border-focus focus:shadow-outline",
        className,
      )}
      {...props}
    />
  );
}

export function AdminActionTextarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-md border border-border bg-surface p-3 text-xs text-text-primary placeholder:text-text-tertiary",
        "focus:outline-none focus:border-border-focus focus:shadow-outline",
        className,
      )}
      {...props}
    />
  );
}

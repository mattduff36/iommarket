"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { Loader2 } from "lucide-react";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold",
    "transition-all duration-fast ease-fast",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
    "disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none",
  ].join(" "),
  {
    variants: {
      variant: {
        energy: [
          "bg-neon-red-500 text-white font-bold uppercase italic",
          "shadow-glow-red",
          "hover:bg-neon-red-400 hover:shadow-[0_0_20px_4px_var(--color-neonRed-glow)]",
          "active:bg-neon-red-600",
        ].join(" "),
        trust: [
          "bg-neon-blue-500 text-white",
          "shadow-glow-blue",
          "hover:bg-neon-blue-400 hover:shadow-[0_0_20px_4px_var(--color-neonBlue-glow)]",
          "active:bg-neon-blue-600",
        ].join(" "),
        premium: [
          "bg-gradient-to-b from-premium-gold-400 to-premium-gold-600 text-black",
          "border border-premium-gold-400",
          "hover:shadow-glow-gold",
          "active:from-premium-gold-500 active:to-premium-gold-600",
        ].join(" "),
        ghost: [
          "text-text-secondary",
          "hover:bg-surface-elevated hover:text-text-primary",
        ].join(" "),
        link: "text-text-trust underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        sm: "h-9 px-5 text-xs rounded-sm",
        md: "h-10 px-6 text-sm rounded-sm",
        lg: "h-12 px-8 text-base rounded-md",
        icon: "h-10 w-10 rounded-sm",
      },
    },
    defaultVariants: {
      variant: "energy",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      disabled,
      leftIcon,
      rightIcon,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-disabled={disabled || loading || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {!loading && leftIcon}
            {children}
            {rightIcon}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors",
  {
    variants: {
      variant: {
        energy:
          "bg-neon-red-500/10 text-neon-red-500 border-neon-red-500",
        trust:
          "bg-neon-blue-500/10 text-neon-blue-500 border-neon-blue-500",
        premium:
          "bg-premium-gold-500/10 text-premium-gold-500 border-premium-gold-500",
        neutral:
          "bg-surface-elevated text-text-secondary border-border",
        success:
          "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
        error:
          "bg-neon-red-500/10 text-neon-red-400 border-neon-red-500/30",
        warning:
          "bg-premium-gold-500/10 text-premium-gold-400 border-premium-gold-500/30",
        info:
          "bg-neon-blue-500/10 text-neon-blue-400 border-neon-blue-500/30",
        price:
          "bg-neon-red-500 text-white border-transparent px-3 py-1 text-sm font-bold",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span
      role="status"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };

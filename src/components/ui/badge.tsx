import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground border border-border",
        // Action variants for OogleMate
        buy: "badge-buy border-transparent",
        watch: "badge-watch border-transparent",
        // Status variants
        passed: "bg-status-passed/20 text-status-passed border border-status-passed/30",
        sold: "bg-status-sold/20 text-status-sold border border-status-sold/30",
        listed: "bg-status-listed/20 text-status-listed border border-status-listed/30",
        withdrawn: "bg-status-withdrawn/20 text-status-withdrawn border border-status-withdrawn/30",
        // Confidence score badges
        "confidence-low": "bg-destructive/20 text-destructive border border-destructive/30",
        "confidence-mid": "bg-action-watch/20 text-action-watch border border-action-watch/30",
        "confidence-high": "bg-primary/20 text-primary border border-primary/30",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };

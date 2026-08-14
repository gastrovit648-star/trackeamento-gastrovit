import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { HTMLAttributes } from "react";

/**
 * Engineered Telemetry badge: 1px border + bg alpha 15% + text 100%.
 * Minimal, tech-feel. Pareado com font-mono uppercase pra IDs/status.
 */
const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-mono font-medium uppercase tracking-[0.08em] transition-colors leading-relaxed",
  {
    variants: {
      variant: {
        default:
          "border-primary/40 bg-primary/15 text-primary",
        secondary:
          "border-border/80 bg-muted/40 text-muted-foreground",
        success:
          "border-primary/40 bg-primary/15 text-primary",
        warning:
          "border-[hsl(var(--accent-amber)/0.4)] bg-[hsl(var(--accent-amber)/0.15)] text-[hsl(var(--accent-amber))]",
        destructive:
          "border-destructive/40 bg-destructive/15 text-destructive",
        outline:
          "border-border/80 bg-transparent text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

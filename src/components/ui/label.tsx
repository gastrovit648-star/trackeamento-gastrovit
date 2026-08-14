"use client";

import * as LabelPrimitive from "@radix-ui/react-label";
import { forwardRef, ComponentPropsWithoutRef, ElementRef } from "react";
import { cn } from "@/lib/utils";

export const Label = forwardRef<
  ElementRef<typeof LabelPrimitive.Root>,
  ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      "block text-[10px] font-mono font-medium uppercase tracking-[0.12em] text-muted-foreground leading-none mb-1.5 peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
      className,
    )}
    {...props}
  />
));
Label.displayName = "Label";

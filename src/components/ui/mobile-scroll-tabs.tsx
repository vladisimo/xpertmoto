"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

/**
 * A `TabsList` that scrolls horizontally on small viewports without
 * clipping the page padding. Use in place of the default `<TabsList>` when
 * a tabs page has more than ~3 triggers, so phone users can swipe between
 * them rather than being stuck on the first few.
 *
 * Bleeds outside its parent's horizontal padding (`-mx-3 px-3` — matching
 * PageShell's mobile `p-3`) so the scroll surface starts at the screen
 * edge — restored to flush at `sm`.
 */
export const MobileScrollTabs = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:overflow-visible sm:px-0">
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        "inline-flex h-10 w-max items-center justify-start gap-1 border-b bg-transparent p-0 sm:w-auto",
        className,
      )}
      {...props}
    />
  </div>
));
MobileScrollTabs.displayName = "MobileScrollTabs";

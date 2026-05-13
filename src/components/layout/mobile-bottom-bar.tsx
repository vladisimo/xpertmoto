"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface MobileBottomBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Visually solid (default) vs translucent over scrolling content. */
  variant?: "solid" | "translucent";
}

/**
 * Sticky bar anchored to the bottom of a mobile viewport. Honours
 * `env(safe-area-inset-bottom)` so it clears the iOS home indicator and
 * Android navigation handle. Place inside a scrolling region, not at the
 * page root, so it sticks to the bottom of the visible scroller.
 *
 * When a Sheet covers the page, mark this `inert` so screen readers and
 * keyboard focus skip the now-hidden actions.
 */
export const MobileBottomBar = React.forwardRef<HTMLDivElement, MobileBottomBarProps>(
  ({ className, variant = "solid", children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "sticky bottom-0 z-40 border-t border-border md:hidden",
        variant === "translucent" ? "bg-background/95 backdrop-blur" : "bg-background",
        "pb-[env(safe-area-inset-bottom)]",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2 px-3 py-2">{children}</div>
    </div>
  ),
);
MobileBottomBar.displayName = "MobileBottomBar";

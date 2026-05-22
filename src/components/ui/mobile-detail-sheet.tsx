"use client";

import * as React from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export interface MobileDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sheet title — required for a11y (rendered visibly unless `hideTitle`). */
  title: string;
  /** Optional supporting line under the title. */
  description?: React.ReactNode;
  /** Visible children — the scrollable detail body. */
  children: React.ReactNode;
  /** Sticky footer slot — usually a primary action button. */
  footer?: React.ReactNode;
  /** Hide the title visually but keep it for screen readers. */
  hideTitle?: boolean;
  /** Sheet side. Defaults to `bottom` on mobile (bottom-sheet idiom). */
  side?: "bottom" | "right";
  className?: string;
}

/**
 * Full-height bottom Sheet for mobile detail / edit views. Replaces
 * dialogs on phones (which clip the viewport) and gives the long-form
 * content a consistent header / scroll body / sticky footer layout.
 *
 * Always renders a `<SheetTitle>` for screen readers — pass `hideTitle`
 * when the visual design suppresses it. The Radix Sheet primitive
 * returns focus to the trigger on close automatically.
 */
export function MobileDetailSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  hideTitle,
  side = "bottom",
  className,
}: MobileDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        className={cn(
          "flex flex-col p-0",
          // dvh (dynamic viewport height) so the sheet shrinks with the
          // iOS Safari URL bar and the sticky footer stays visible.
          side === "bottom" && "h-[92dvh] rounded-t-xl",
          side === "right" && "w-full sm:max-w-md",
          className,
        )}
      >
        <header className="shrink-0 border-b border-border px-4 py-3">
          <SheetTitle
            className={cn(
              "text-base font-semibold",
              hideTitle && "sr-only",
            )}
          >
            {title}
          </SheetTitle>
          {description ? (
            <SheetDescription className="mt-0.5 text-caption text-muted-foreground">
              {description}
            </SheetDescription>
          ) : null}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer ? (
          <div
            className={cn(
              "shrink-0 border-t border-border bg-background px-4 py-3",
              "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
            )}
          >
            {footer}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

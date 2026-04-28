import * as React from "react";
import { cn } from "@/lib/utils";

type Cols = 1 | 2 | 3;

export interface FormGridProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Column count at the `md` breakpoint and up. Mobile is always 1 column. */
  cols?: Cols;
}

const COLS_CLASSES: Record<Cols, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 md:grid-cols-2",
  3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
};

/**
 * Responsive form grid. Use as the direct parent of `<FormField>` elements.
 * Single-column on mobile; `cols` controls the desktop layout.
 * Children that should span the full width can opt in with `md:col-span-2`
 * (or use the {@link FormGridRow} helper).
 */
export const FormGrid = React.forwardRef<HTMLDivElement, FormGridProps>(
  ({ cols = 2, className, ...props }, ref) => (
    <div ref={ref} className={cn("grid gap-6", COLS_CLASSES[cols], className)} {...props} />
  ),
);
FormGrid.displayName = "FormGrid";

/**
 * A row inside FormGrid that spans every column regardless of grid cols.
 * Use for textareas, full-width alerts, or submit rows.
 */
export const FormGridRow = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("md:col-span-2 lg:col-span-3", className)} {...props} />
  ),
);
FormGridRow.displayName = "FormGridRow";

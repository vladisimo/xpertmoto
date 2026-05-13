import * as React from "react";
import { cn } from "@/lib/utils";

export interface MobileEmptyStateProps {
  /** Icon or illustration node. Sized to ~40×40 by the component. */
  icon?: React.ReactNode;
  /** Short headline ("No bookings today"). */
  title: React.ReactNode;
  /** Supporting copy explaining why and what to do next. */
  description?: React.ReactNode;
  /** Right-of-CTA / below-CTA slot — usually a `<Button>` or `<Link>`. */
  action?: React.ReactNode;
  className?: string;
}

/**
 * Consistent mobile empty state. Renders inside any list, tab body, or
 * card — provides a single, predictable shape for "nothing here yet".
 */
export function MobileEmptyState({
  icon,
  title,
  description,
  action,
  className,
}: MobileEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-md border border-dashed bg-card px-6 py-10 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="text-body font-medium text-foreground">{title}</p>
        {description ? (
          <p className="max-w-sm text-caption text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

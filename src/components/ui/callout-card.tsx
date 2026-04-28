import * as React from "react";
import { AlertTriangle, AlertCircle, Info, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "info" | "warning" | "danger";

const TONE_STYLES: Record<Tone, { wrapper: string; icon: string }> = {
  info:    { wrapper: "border-l-foreground/70", icon: "text-foreground" },
  warning: { wrapper: "border-l-amber-500",     icon: "text-amber-600 dark:text-amber-400" },
  danger:  { wrapper: "border-l-destructive",   icon: "text-destructive" },
};

const TONE_ICONS: Record<Tone, LucideIcon> = {
  info: Info,
  warning: AlertTriangle,
  danger: AlertCircle,
};

export interface CalloutCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  tone?: Tone;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  hideIcon?: boolean;
}

/**
 * Neutral-fill card with a tone-coloured left border and icon. Use for "this
 * needs attention" surfaces where a hard amber/red fill would fight the brand
 * palette. Preserves scanability via the coloured stripe + icon.
 */
export const CalloutCard = React.forwardRef<HTMLDivElement, CalloutCardProps>(
  ({ tone = "info", title, description, action, hideIcon, className, ...props }, ref) => {
    const Icon = TONE_ICONS[tone];
    const styles = TONE_STYLES[tone];
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-md border border-border bg-muted p-4 border-l-4",
          styles.wrapper,
          className,
        )}
        {...props}
      >
        <div className="flex items-start gap-4">
          {!hideIcon && <Icon className={cn("mt-0.5 h-5 w-5 flex-shrink-0", styles.icon)} strokeWidth={2} />}
          <div className="flex-1 space-y-1">
            <div className="font-semibold text-foreground">{title}</div>
            {description && <div className="text-sm text-muted-foreground">{description}</div>}
          </div>
          {action && <div className="hidden flex-shrink-0 sm:block">{action}</div>}
        </div>
        {action && <div className="mt-3 flex justify-end sm:hidden">{action}</div>}
      </div>
    );
  },
);
CalloutCard.displayName = "CalloutCard";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<Size, string> = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-12 w-12",
};

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: Size;
  /** Screen-reader label. Defaults to "Loading". */
  label?: string;
}

export const Spinner = React.forwardRef<HTMLSpanElement, SpinnerProps>(
  ({ size = "md", label = "Loading", className, ...props }, ref) => {
    return (
      <span
        ref={ref}
        role="status"
        aria-live="polite"
        className={cn("inline-flex text-muted-foreground", className)}
        {...props}
      >
        <Loader2 className={cn("animate-spin", SIZE_CLASSES[size])} aria-hidden />
        <span className="sr-only">{label}</span>
      </span>
    );
  },
);
Spinner.displayName = "Spinner";

type Padded = "sm" | "md" | "lg";

const PADDED_CLASSES: Record<Padded, string> = {
  sm: "py-4",
  md: "py-8",
  lg: "p-8",
};

export interface LoadingBlockProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: Size;
  padded?: Padded;
  label?: string;
}

export const LoadingBlock = React.forwardRef<HTMLDivElement, LoadingBlockProps>(
  ({ size = "md", padded = "md", label, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("flex items-center justify-center", PADDED_CLASSES[padded], className)}
        {...props}
      >
        <Spinner size={size} label={label} />
      </div>
    );
  },
);
LoadingBlock.displayName = "LoadingBlock";

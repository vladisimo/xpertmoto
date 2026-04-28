import { cn } from "@/lib/utils";

export interface DividedTitleProps {
  children: React.ReactNode;
  /** Heading level. Defaults to h2. */
  as?: "h1" | "h2" | "h3";
  /** Size utility class. Defaults to `.h1`. */
  size?: "h1" | "h2" | "h3";
  className?: string;
}

/**
 * Section heading flanked by yellow horizontal rules — mirrors XPERT Moto's
 * "Xpert rentals" / "Xpert tours" section titles. Use inside a `<PageSection>`
 * or marketing container; don't use as the page-level title (that's `PageHeader`).
 */
export function DividedTitle({ children, as = "h2", size = "h1", className }: DividedTitleProps) {
  const Heading = as;
  const sizeClass = size === "h1" ? "h1" : size === "h2" ? "h2" : "h3";
  return (
    <div className={cn("flex items-center gap-4", className)}>
      <div aria-hidden className="h-px flex-1 bg-secondary" />
      <Heading className={cn(sizeClass, "text-center")}>{children}</Heading>
      <div aria-hidden className="h-px flex-1 bg-secondary" />
    </div>
  );
}

import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

interface FaqItem {
  q: string;
  a: string;
}

interface FaqListProps {
  items: FaqItem[];
  className?: string;
}

export function FaqList({ items, className }: FaqListProps) {
  return (
    <div className={cn("divide-y divide-border rounded-lg border border-border bg-card", className)}>
      {items.map((item) => (
        <details key={item.q} className="group px-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left font-medium text-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <span>{item.q}</span>
            <ChevronDown
              aria-hidden
              className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
            />
          </summary>
          <p className="pb-6 pr-10 text-muted-foreground">{item.a}</p>
        </details>
      ))}
    </div>
  );
}

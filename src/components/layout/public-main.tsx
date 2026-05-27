"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Top-padding sibling of `<PublicHeader>`. Pads the main content area to
 * clear the fixed header — `pt-20` (80px) by default, tightened to
 * `pt-14` (56px) on `/booking*` to match the shorter wizard navbar.
 * `/why-xpert` renders without the header (a full-viewport scroll-snap
 * page), so it gets no top padding.
 */
export function PublicMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const onBooking = pathname.startsWith("/booking");
  const fullBleed = pathname.startsWith("/why-xpert");
  return (
    <main className={cn("flex-1", fullBleed ? "pt-0" : onBooking ? "pt-14" : "pt-20")}>
      {children}
    </main>
  );
}

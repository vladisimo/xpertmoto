"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Top-padding sibling of `<PublicHeader>`. Pads the main content area to
 * clear the fixed header — `pt-20` (80px) by default, tightened to
 * `pt-14` (56px) on `/booking*` to match the shorter wizard navbar.
 */
export function PublicMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const onBooking = pathname.startsWith("/booking");
  return (
    <main className={cn("flex-1", onBooking ? "pt-14" : "pt-20")}>
      {children}
    </main>
  );
}

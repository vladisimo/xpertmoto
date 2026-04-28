"use client";

import { usePathname } from "next/navigation";

export function ReviewsShowcaseSlot({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/booking")) return null;
  return <>{children}</>;
}

"use client";

import { usePathname } from "next/navigation";

/**
 * Client gate that hides its children whenever the user is inside the
 * booking wizard (`/booking*`). Lets the (public) layout — a server
 * component — defer footer / reviews / chat-launcher rendering decisions
 * to the client without making the entire layout client-side.
 */
export function HideOnBooking({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname.startsWith("/booking")) return null;
  return <>{children}</>;
}

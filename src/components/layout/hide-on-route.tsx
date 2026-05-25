"use client";

import { usePathname } from "next/navigation";

/**
 * Client gate that hides its children on any of the given path prefixes.
 * Lets the (public) layout — a server component — defer chrome rendering
 * decisions (header / footer / reviews / chat launcher) to the client
 * without making the entire layout client-side.
 */
export function HideOnRoute({
  prefixes,
  children,
}: {
  prefixes: string[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  if (prefixes.some((p) => pathname.startsWith(p))) return null;
  return <>{children}</>;
}

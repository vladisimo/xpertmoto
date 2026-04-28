"use client";

import { useEffect, useState } from "react";

/**
 * Mobile is ≤767px — matches Tailwind's `md` breakpoint boundary. Tablets
 * in portrait (768–1023px) render the desktop shell, which the design
 * deliberately accommodates via the narrower `lg:grid-cols-[1fr_320px]`
 * form factor.
 */
const MOBILE_MEDIA_QUERY = "(max-width: 767px)";

/**
 * SSR-safe breakpoint hook. Returns `false` on the server and during the
 * first client render (hydration parity), then flips to the real value
 * on mount. Components that branch on this must therefore render the
 * desktop shell as the hydration-matching default.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(MOBILE_MEDIA_QUERY);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  return isMobile;
}

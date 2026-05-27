"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Full-viewport scroll-snap panel for the /why-xpert page.
 *
 * Each panel fills the viewport and snaps into place. Only the panel
 * currently in focus (>55% visible) is shown — the panels before and after
 * fade out and park slightly to the right, so the focused section slides in
 * from the right as you scroll. Respects `prefers-reduced-motion`.
 *
 * Tall content scrolls inside its own panel (`overflow-y-auto`) so the page
 * never reveals two sections at once.
 */
export function SnapSection({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setActive(entry.isIntersecting);
      },
      { threshold: 0.55 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={ref}
      className="flex min-h-[100svh] w-full snap-start snap-always items-center justify-center px-4 py-16 sm:px-6"
    >
      <div
        className={cn(
          "max-h-[100svh] w-full max-w-5xl overflow-y-auto transition-all duration-700 ease-out will-change-transform motion-reduce:transition-none",
          active
            ? "translate-x-0 opacity-100"
            : "translate-x-16 opacity-0 motion-reduce:translate-x-0 motion-reduce:opacity-100",
          className,
        )}
      >
        {children}
      </div>
    </section>
  );
}

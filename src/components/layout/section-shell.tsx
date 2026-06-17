"use client";

/**
 * Page-level layout wrapper that adds a second navigation surface — a dark
 * horizontal "top bar" — above the page content on large screens. Render it
 * as the page root (inside <main>), wrapping the usual <PageShell> tree.
 *
 * Layout model: a flex column whose top row is the fixed top bar and whose
 * second row owns the scroll. Moving the scroll boundary off <main> into the
 * content row keeps the bar pinned while content scrolls — and works for
 * both `full` PageShell pages (inner region scrolls) and non-`full` pages
 * (the row scrolls). Below lg the top bar is hidden and the page scrolls as
 * before; the horizontal <SectionNav> strip stays inside PageShell as the
 * fallback. See [section-nav.tsx](./section-nav.tsx).
 */

import * as React from "react";
import { SectionTopBar, type SectionKey } from "@/components/layout/section-nav";

export function SectionShell({
  section,
  isAdmin = false,
  children,
}: {
  section: SectionKey;
  /** Forwarded to the top bar so admin-only items filter consistently. */
  isAdmin?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* A notch lighter than the pure-black primary nav (ties into the
          slate-800/900 flyout family) with a seam border, so the secondary
          bar reads as a distinct panel rather than merging into one slab. */}
      <div className="hidden h-12 shrink-0 items-center gap-1 overflow-x-auto border-b border-white/10 bg-slate-900 px-3 lg:flex">
        <SectionTopBar section={section} isAdmin={isAdmin} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </div>
  );
}

"use client";

import { useEffect } from "react";

export function SilenceExtensionHydrationWarning() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;

    const original = console.error;
    console.error = (...args: unknown[]) => {
      const msg = typeof args[0] === "string" ? args[0] : "";
      const joined = args.map((a) => (typeof a === "string" ? a : "")).join(" ");
      if (
        (msg.includes("hydrated") || msg.includes("hydration")) &&
        /fdprocessedid|bis_skin_checked|cz-shortcut-listen|__gchrome_|__gcruniqueid/i.test(joined)
      ) {
        return;
      }
      original(...(args as Parameters<typeof console.error>));
    };

    return () => {
      console.error = original;
    };
  }, []);

  return null;
}

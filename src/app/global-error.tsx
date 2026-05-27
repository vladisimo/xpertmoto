"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";

/**
 * Root-level error boundary. Next.js renders this only when an error is
 * thrown in the root layout/template itself — the one place the segment-level
 * `error.tsx` cannot reach. It replaces the whole document, so it must render
 * its own <html>/<body> and can't assume the app's CSS or fonts loaded;
 * styles are intentionally inline.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en-AU">
      <body
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          padding: "1.5rem",
        }}
      >
        <div style={{ maxWidth: "28rem", textAlign: "center" }}>
          <div style={{ fontSize: "3.75rem" }}>⚠️</div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginTop: "1rem" }}>
            Something went wrong
          </h1>
          <p style={{ color: "#6b7280", fontSize: "0.875rem", marginTop: "0.5rem" }}>
            We&apos;ve logged the error. Please reload the page.
          </p>
          {error.digest && (
            <p
              style={{
                fontSize: "0.75rem",
                color: "#9ca3af",
                fontFamily: "monospace",
                marginTop: "0.5rem",
              }}
            >
              {error.digest}
            </p>
          )}
          <Link
            href="/"
            style={{
              display: "inline-block",
              marginTop: "1rem",
              padding: "0.5rem 1rem",
              border: "1px solid #d1d5db",
              borderRadius: "0.375rem",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            Home
          </Link>
        </div>
      </body>
    </html>
  );
}

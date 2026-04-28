"use client";
import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        <div className="text-6xl">⚠️</div>
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="text-muted-foreground text-sm">
          We&apos;ve logged the error. Try again, or return home.
        </p>
        {error.digest && <p className="text-xs text-muted-foreground font-mono">{error.digest}</p>}
        <div className="flex gap-2 justify-center">
          <button onClick={reset} className="px-4 py-2 bg-primary text-primary-foreground rounded">Try again</button>
          <Link href="/" className="px-4 py-2 border rounded">Home</Link>
        </div>
      </div>
    </div>
  );
}

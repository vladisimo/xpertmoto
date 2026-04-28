import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="text-center space-y-4">
        <div className="text-6xl">🛵💨</div>
        <h1 className="text-3xl font-bold">Page not found</h1>
        <p className="text-muted-foreground">That ride seems to have left the depot.</p>
        <Link href="/" className="inline-block px-4 py-2 bg-primary text-primary-foreground rounded">Back home</Link>
      </div>
    </div>
  );
}

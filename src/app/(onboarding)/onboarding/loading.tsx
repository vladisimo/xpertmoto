export default function Loading() {
  return (
    <div
      aria-busy="true"
      className="flex min-h-screen items-center justify-center p-6"
    >
      <div className="w-full max-w-md space-y-4">
        <div className="h-7 w-56 animate-pulse rounded-md bg-muted" />
        <div className="h-72 animate-pulse rounded-lg bg-muted/60" />
      </div>
    </div>
  );
}

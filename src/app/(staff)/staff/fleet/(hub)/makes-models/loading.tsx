export default function Loading() {
  return (
    <div aria-busy="true" className="flex-1 space-y-4 overflow-hidden p-4">
      <div className="h-7 w-56 animate-pulse rounded-md bg-muted" />
      <div className="h-72 animate-pulse rounded-lg bg-muted/60" />
    </div>
  );
}

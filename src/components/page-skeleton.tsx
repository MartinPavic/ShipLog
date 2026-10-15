export function PageSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="max-w-3xl animate-pulse space-y-6">
      <div className="space-y-2">
        <div className="h-7 w-1/3 rounded bg-muted" />
        <div className="h-4 w-2/3 rounded bg-muted" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-24 rounded-lg bg-muted" />
      ))}
    </div>
  );
}

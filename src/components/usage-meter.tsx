export function UsageMeter({ used, limit }: { used: number; limit: number | null }) {
  if (limit === null) {
    return <p className="text-sm text-muted-foreground">{used} generations this month</p>;
  }
  if (limit === 0) {
    return <p className="text-sm text-muted-foreground">Generating requires Pro in this workspace</p>;
  }
  const pct = Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  return (
    <div className="space-y-1">
      <p className="text-sm text-muted-foreground">
        {used} / {limit} generations this month
      </p>
      <div
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
        className="h-1.5 w-48 overflow-hidden rounded-full bg-muted"
      >
        <div className={`h-full ${pct >= 100 ? "bg-danger" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

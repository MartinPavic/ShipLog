import type { Activity } from "@/lib/github-activity";

const day = (iso: string) => iso.slice(0, 10);

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title} ({count})
      </h4>
      <ul className="space-y-1 text-sm">{children}</ul>
    </div>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
      {children}
    </a>
  );
}

// The activity GitHub reported for the period, so readers can check what the log was based on.
export function SourcePanel({ activity }: { activity: Activity }) {
  const repos = activity.repos.filter(
    (r) => r.commits.length + r.pullRequests.length + r.issues.length + r.releases.length > 0
  );
  if (repos.length === 0) return null;

  return (
    <details className="rounded-lg border p-4">
      <summary className="cursor-pointer text-sm font-medium">Source activity</summary>
      <div className="mt-4 space-y-6">
        {repos.map((r) => (
          <div key={r.repo} className="space-y-3">
            <h3 className="text-sm font-semibold">{r.repo}</h3>
            <Section title="Releases" count={r.releases.length}>
              {r.releases.map((x) => (
                <li key={x.tag}>
                  <ExternalLink href={x.url}>{x.name}</ExternalLink>{" "}
                  <span className="text-muted-foreground">{day(x.publishedAt)}</span>
                </li>
              ))}
            </Section>
            <Section title="Merged pull requests" count={r.pullRequests.length}>
              {r.pullRequests.map((x) => (
                <li key={x.number}>
                  <ExternalLink href={x.url}>
                    #{x.number} {x.title}
                  </ExternalLink>{" "}
                  <span className="text-muted-foreground">
                    {x.author}, {day(x.mergedAt)}
                  </span>
                </li>
              ))}
            </Section>
            <Section title="Closed issues" count={r.issues.length}>
              {r.issues.map((x) => (
                <li key={x.number}>
                  <ExternalLink href={x.url}>
                    #{x.number} {x.title}
                  </ExternalLink>{" "}
                  <span className="text-muted-foreground">{day(x.closedAt)}</span>
                </li>
              ))}
            </Section>
            <Section title="Commits" count={r.commits.length}>
              {r.commits.map((x) => (
                <li key={x.sha}>
                  <ExternalLink href={x.url}>
                    <code className="text-xs">{x.sha}</code>
                  </ExternalLink>{" "}
                  {x.message} <span className="text-muted-foreground">{x.author}</span>
                </li>
              ))}
            </Section>
            {Object.values(r.omitted).some((n) => n > 0) && (
              <p className="text-xs text-muted-foreground">
                Omitted for length:{" "}
                {Object.entries(r.omitted)
                  .filter(([, n]) => n > 0)
                  .map(([k, n]) => `${n} ${k}`)
                  .join(", ")}
              </p>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

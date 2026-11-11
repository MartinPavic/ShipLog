import { z } from "zod";
import { ApiError } from "@/lib/api";
import type { SentryProjectRef } from "@/db/schema";
import { fetchSentryOrganizationPage, invalidResponse } from "@/lib/sentry-api";

const MAX_ISSUES = 25;
const ISSUE_PAGE_SIZE = 25;
const MAX_ISSUE_PAGES = 3;
const EVENT_PAGE_SIZE = 100;
const MAX_EVENT_PAGES = 3;
const CONCURRENCY = 3;
const MAX_TITLE_LENGTH = 200;
const OVERALL_TIMEOUT_MS = 45_000;

export type SentryConnection = { organizationSlug: string; token: string };
export type SentryIssue = {
  id: string;
  title: string;
  level: string;
  status: string;
  // Events inside the report window only; a lower bound when countCapped.
  eventCount: number;
  countCapped: boolean;
  projectId: string;
  projectName: string;
  url: string;
  lastSeen: string;
};
export type SentryActivity = { issues: SentryIssue[] };

const issueRowSchema = z.object({
  id: z.string().regex(/^\d{1,20}$/),
  title: z.string(),
  level: z.unknown(),
  status: z.unknown(),
  project: z.object({ id: z.string() }),
  lastSeen: z.string(),
});
const issuePageSchema = z.array(z.unknown()).max(ISSUE_PAGE_SIZE);
const eventPageSchema = z.array(z.unknown()).max(EVENT_PAGE_SIZE);

const oneLine = (text: string, max: number) => text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const token = (value: unknown) => {
  const text = typeof value === "string" ? value.toLowerCase() : "";
  return /^[a-z_]{1,20}$/.test(text) ? text : "unknown";
};

async function getPage(connection: SentryConnection, path: string, params: [string, string][], signal: AbortSignal) {
  return fetchSentryOrganizationPage(connection, path, params, {
    signal,
    scopes: ["project:read", "event:read"],
    errors: { notFound: "Sentry could not find the organization or issue. Check the connection." },
  });
}

async function listCandidates(connection: SentryConnection, projects: SentryProjectRef[], since: Date, until: Date, signal: AbortSignal) {
  const selected = new Map(projects.map((p) => [p.id, p]));
  const candidates: Omit<SentryIssue, "eventCount" | "countCapped">[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_ISSUE_PAGES && candidates.length < MAX_ISSUES; page++) {
    const params: [string, string][] = [
      ...projects.map((p): [string, string] => ["project", p.id]),
      ["start", since.toISOString()],
      ["end", until.toISOString()],
      // Empty query: the default would hide resolved/ignored issues.
      ["query", ""],
      ["sort", "freq"],
      ["limit", String(ISSUE_PAGE_SIZE)],
    ];
    if (cursor) params.push(["cursor", cursor]);

    const result = await getPage(connection, "issues/", params, signal);
    const rows = issuePageSchema.safeParse(result.body);
    if (!rows.success) throw invalidResponse();

    for (const raw of rows.data) {
      const row = issueRowSchema.safeParse(raw);
      const lastSeen = row.success ? new Date(row.data.lastSeen) : null;
      const project = row.success ? selected.get(row.data.project.id) : undefined;
      if (!row.success || !project || !lastSeen || Number.isNaN(lastSeen.getTime())) continue;
      if (candidates.some((c) => c.id === row.data.id)) continue;
      if (candidates.length >= MAX_ISSUES) break;

      candidates.push({
        id: row.data.id,
        title: oneLine(row.data.title, MAX_TITLE_LENGTH) || "(untitled)",
        level: token(row.data.level),
        status: token(row.data.status),
        projectId: project.id,
        projectName: oneLine(project.name, MAX_TITLE_LENGTH) || "(unknown project)",
        url: `https://sentry.io/organizations/${encodeURIComponent(connection.organizationSlug)}/issues/${row.data.id}/`,
        lastSeen: lastSeen.toISOString(),
      });
    }
    if (!result.cursor) break;
    cursor = result.cursor;
  }
  return candidates;
}

// Counts rows only; event payloads are never read.
async function countEvents(connection: SentryConnection, issueId: string, since: Date, until: Date, signal: AbortSignal) {
  let count = 0;
  let cursor: string | undefined;
  for (let page = 0; page < MAX_EVENT_PAGES; page++) {
    const params: [string, string][] = [
      ["start", since.toISOString()],
      ["end", until.toISOString()],
      ["per_page", String(EVENT_PAGE_SIZE)],
      ["full", "false"],
    ];
    if (cursor) params.push(["cursor", cursor]);

    let result;
    try {
      result = await getPage(connection, `issues/${issueId}/events/`, params, signal);
    } catch (error) {
      if (error instanceof ApiError && error.code === "SENTRY_NOT_FOUND") {
        return { count: 0, capped: false };
      }
      throw error;
    }
    const rows = eventPageSchema.safeParse(result.body);
    if (!rows.success) throw invalidResponse();
    count += rows.data.length;
    if (!result.cursor) return { count, capped: false };
    cursor = result.cursor;
  }
  return { count, capped: true };
}

export async function fetchSentryActivity(
  connection: SentryConnection,
  projects: SentryProjectRef[],
  since: Date,
  until: Date
): Promise<SentryActivity> {
  if (projects.length === 0) return { issues: [] };

  const overallAbort = new AbortController();
  const timeout = setTimeout(() => {
    overallAbort.abort(new DOMException("overall timeout", "TimeoutError"));
  }, OVERALL_TIMEOUT_MS);

  try {
    const candidates = await listCandidates(connection, projects, since, until, overallAbort.signal);
    const counted = new Array<{ count: number; capped: boolean }>(candidates.length);
    let nextIndex = 0;
    let failed = false;
    const workers = Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, async () => {
        while (!failed && nextIndex < candidates.length) {
          const index = nextIndex++;
          try {
            counted[index] = await countEvents(connection, candidates[index].id, since, until, overallAbort.signal);
          } catch (error) {
            failed = true;
            overallAbort.abort(error);
            throw error;
          }
        }
      });
    const workerResults = await Promise.allSettled(workers);
    const firstFailure = workerResults.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (firstFailure) throw firstFailure.reason;

    // Issues listed by lastSeen overlap can have no events inside the window itself.
    return {
      issues: candidates.flatMap((candidate, i) =>
        counted[i].count > 0 ? [{ ...candidate, eventCount: counted[i].count, countCapped: counted[i].capped }] : []
      ),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function formatSentryActivity(activity: SentryActivity): string {
  if (activity.issues.length === 0) return "No Sentry issues had events in this period.";
  const lines = activity.issues.map((issue) => {
    const events = `${issue.countCapped ? "at least " : ""}${issue.eventCount} event${issue.eventCount === 1 ? "" : "s"}`;
    const projectName = JSON.stringify(oneLine(issue.projectName, MAX_TITLE_LENGTH) || "(unknown project)");
    return `- [${issue.level}/${issue.status}] ${JSON.stringify(issue.title)} (${projectName}) - ${events} in period; last seen (Sentry all-time) ${issue.lastSeen}; ${issue.url}`;
  });
  return [
    "Sentry issues with events in this period (counts cover the period only).",
    "Only up to the 25 most frequent issue candidates are listed here; this is not a complete list of all issues.",
    ...lines,
  ].join("\n");
}

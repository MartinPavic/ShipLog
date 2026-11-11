import { z } from "zod";
import { ApiError } from "@/lib/api";
import type { SentryProjectRef } from "@/db/schema";

// Hosted Sentry only; callers can never choose the origin or path prefix.
const SENTRY_API = "https://sentry.io/api/0/";
const REQUEST_TIMEOUT_MS = 10_000;

const MAX_ISSUES = 25;
const ISSUE_PAGE_SIZE = 25;
const MAX_ISSUE_PAGES = 3;
const EVENT_PAGE_SIZE = 100;
const MAX_EVENT_PAGES = 3;
const CONCURRENCY = 3;
const MAX_TITLE_LENGTH = 200;

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

const invalidResponse = () => new ApiError(502, "Sentry returned an unexpected response.", "SENTRY_INVALID_RESPONSE");

function sentryError(status: number): ApiError {
  if (status >= 300 && status < 400) {
    return new ApiError(502, "Sentry redirected the request, which is not allowed.", "SENTRY_REDIRECT");
  }
  if (status === 401) return new ApiError(400, "Sentry rejected the token. Check that it is valid and has event:read access.", "SENTRY_AUTH");
  if (status === 403) return new ApiError(400, "The Sentry token does not have event:read access to this organization.", "SENTRY_FORBIDDEN");
  if (status === 404) return new ApiError(400, "Sentry could not find the organization or issue. Check the connection.", "SENTRY_NOT_FOUND");
  if (status === 429) return new ApiError(429, "Sentry is rate limiting this connection. Try again shortly.", "SENTRY_RATE_LIMIT");
  return new ApiError(502, "Sentry is temporarily unavailable. Try again shortly.", "SENTRY_UNAVAILABLE");
}

// Only the cursor is taken from the Link header; the URL itself is never followed.
function nextCursor(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(/,\s*(?=<)/)) {
    if (!/\brel="next"/.test(part) || !/\bresults="true"/.test(part)) continue;
    const cursor = /\bcursor="([^"]*)"/.exec(part)?.[1];
    if (!cursor || !/^[\w:.-]{1,100}$/.test(cursor)) throw invalidResponse();
    return cursor;
  }
  return null;
}

async function getPage(connection: SentryConnection, path: string, params: [string, string][]) {
  const url = new URL(`organizations/${encodeURIComponent(connection.organizationSlug)}/${path}`, SENTRY_API);
  for (const [key, value] of params) url.searchParams.append(key, value);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${connection.token}`, Accept: "application/json" },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new ApiError(504, "Sentry took too long to respond. Try again shortly.", "SENTRY_TIMEOUT");
    }
    throw sentryError(0);
  }
  if (response.type === "opaqueredirect") throw sentryError(302);
  if (!response.ok) throw sentryError(response.status);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw invalidResponse();
  }
  return { body, cursor: nextCursor(response.headers.get("link")) };
}

const oneLine = (text: string, max: number) => text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const token = (value: unknown) => {
  const text = typeof value === "string" ? value.toLowerCase() : "";
  return /^[a-z_]{1,20}$/.test(text) ? text : "unknown";
};

async function listCandidates(connection: SentryConnection, projects: SentryProjectRef[], since: Date, until: Date) {
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

    const result = await getPage(connection, "issues/", params);
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
        projectName: project.name,
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
async function countEvents(connection: SentryConnection, issueId: string, since: Date, until: Date) {
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

    const result = await getPage(connection, `issues/${issueId}/events/`, params);
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

  const candidates = await listCandidates(connection, projects, since, until);
  const counted = new Array<{ count: number; capped: boolean }>(candidates.length);
  let nextIndex = 0;
  let failed = false;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, async () => {
      while (!failed && nextIndex < candidates.length) {
        const index = nextIndex++;
        try {
          counted[index] = await countEvents(connection, candidates[index].id, since, until);
        } catch (error) {
          failed = true;
          throw error;
        }
      }
    })
  );

  // Issues listed by lastSeen overlap can have no events inside the window itself.
  return {
    issues: candidates.flatMap((candidate, i) =>
      counted[i].count > 0 ? [{ ...candidate, eventCount: counted[i].count, countCapped: counted[i].capped }] : []
    ),
  };
}

export function formatSentryActivity(activity: SentryActivity): string {
  if (activity.issues.length === 0) return "No Sentry issues had events in this period.";
  const lines = activity.issues.map((issue) => {
    const events = `${issue.countCapped ? "at least " : ""}${issue.eventCount} event${issue.eventCount === 1 ? "" : "s"}`;
    return `- [${issue.level}/${issue.status}] ${JSON.stringify(issue.title)} (${issue.projectName}) - ${events} in period; last seen ${issue.lastSeen}; ${issue.url}`;
  });
  return ["Sentry issues with events in this period (counts cover the period only):", ...lines].join("\n");
}

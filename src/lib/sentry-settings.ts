import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { sentryConnections, type SentryProjectRef } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { decrypt, encrypt, last4 } from "@/lib/crypto";
import { sentryProjectSchema, sentrySettingsSchema } from "@/lib/validation";

// Hosted Sentry only; callers can never choose the origin or path prefix.
const SENTRY_API = "https://sentry.io/api/0/";
const PER_PAGE = 100;
const MAX_PAGES = 10;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_PROJECT_NAME_LENGTH = 200;

const projectPageSchema = z.array(z.unknown()).max(PER_PAGE);

const upstreamProjectRowSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
});

function sentryError(status: number): ApiError {
  if (status === 401) return new ApiError(400, "Sentry rejected the token. Check that it is valid and has project:read access.", "SENTRY_AUTH");
  if (status === 403) return new ApiError(400, "The Sentry token does not have project:read access to this organization.", "SENTRY_FORBIDDEN");
  if (status === 404) return new ApiError(400, "Sentry could not find that organization. Check the organization slug.", "SENTRY_NOT_FOUND");
  if (status === 429) return new ApiError(429, "Sentry is rate limiting this connection. Try again shortly.", "SENTRY_RATE_LIMIT");
  return new ApiError(502, "Sentry is temporarily unavailable. Try again shortly.", "SENTRY_UNAVAILABLE");
}

const invalidResponse = () => new ApiError(502, "Sentry returned an unexpected response.", "SENTRY_INVALID_RESPONSE");

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

async function fetchProjectPage(organizationSlug: string, token: string, cursor?: string) {
  const url = new URL(`organizations/${encodeURIComponent(organizationSlug)}/projects/`, SENTRY_API);
  url.searchParams.set("per_page", String(PER_PAGE));
  if (cursor) url.searchParams.set("cursor", cursor);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
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
  if (!response.ok) throw sentryError(response.status);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw invalidResponse();
  }
  const parsed = projectPageSchema.safeParse(body);
  if (!parsed.success) throw invalidResponse();

  const projects: SentryProjectRef[] = [];
  for (const row of parsed.data) {
    const upstream = upstreamProjectRowSchema.safeParse(row);
    if (!upstream.success) continue;

    const normalized = sentryProjectSchema.safeParse({
      id: upstream.data.id,
      slug: upstream.data.slug,
      name: upstream.data.name.slice(0, MAX_PROJECT_NAME_LENGTH),
    });
    if (!normalized.success) continue;
    projects.push(normalized.data);
  }

  return { projects, nextCursor: nextCursor(response.headers.get("link")) };
}

export async function getSentryConnection(ownerId: string) {
  const [row] = await getDb().select().from(sentryConnections).where(eq(sentryConnections.ownerId, ownerId)).limit(1);
  if (!row) return null;
  const token = decrypt(row.encryptedToken);
  return { organizationSlug: row.organizationSlug, token, last4: last4(token) };
}

export async function getSentryStatus(ownerId: string) {
  const [row] = await getDb()
    .select({ organizationSlug: sentryConnections.organizationSlug, encryptedToken: sentryConnections.encryptedToken })
    .from(sentryConnections)
    .where(eq(sentryConnections.ownerId, ownerId))
    .limit(1);
  if (!row) return { configured: false as const, organizationSlug: null, last4: null };

  try {
    return {
      configured: true as const,
      organizationSlug: row.organizationSlug,
      last4: last4(decrypt(row.encryptedToken)),
    };
  } catch {
    // Keep the settings page repairable even if the stored ciphertext is unreadable.
    return { configured: true as const, organizationSlug: row.organizationSlug, last4: null };
  }
}

// Verifies the token and organization against Sentry before anything is stored; project selections are untouched.
export async function saveSentryConnection(ownerId: string, organizationSlug: string, token: string) {
  const input = sentrySettingsSchema.parse({ organizationSlug, token });
  await fetchProjectPage(input.organizationSlug, input.token);
  const values = { organizationSlug: input.organizationSlug, encryptedToken: encrypt(input.token), updatedAt: new Date() };
  await getDb()
    .insert(sentryConnections)
    .values({ ownerId, ...values })
    .onConflictDoUpdate({ target: sentryConnections.ownerId, set: values });
}

export async function deleteSentryConnection(ownerId: string) {
  await getDb().delete(sentryConnections).where(eq(sentryConnections.ownerId, ownerId));
}

export async function listSentryProjects(ownerId: string): Promise<SentryProjectRef[]> {
  const connection = await getSentryConnection(ownerId);
  if (!connection) throw new ApiError(400, "Connect Sentry in Settings first.", "NO_SENTRY");

  const projects: SentryProjectRef[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await fetchProjectPage(connection.organizationSlug, connection.token, cursor);
    projects.push(...result.projects);
    if (!result.nextCursor) {
      cursor = undefined;
      break;
    }
    cursor = result.nextCursor;
  }
  if (cursor) {
    throw new ApiError(
      502,
      "Sentry returned more than 1000 projects. Narrow the organization project set or contact support.",
      "SENTRY_PAGE_LIMIT"
    );
  }
  return projects;
}

// Submitted slugs and names are never trusted: only ids are matched, and the stored record comes from Sentry.
export async function canonicalizeSentryProjects(ownerId: string, submitted: SentryProjectRef[]): Promise<SentryProjectRef[]> {
  if (submitted.length === 0) return [];
  const accessible = new Map((await listSentryProjects(ownerId)).map((project) => [project.id, project]));
  return submitted.map(({ id }) => {
    const project = accessible.get(id);
    if (!project) {
      throw new ApiError(
        400,
        "A selected Sentry project is not accessible with the connected token. Remove it or reconnect Sentry.",
        "SENTRY_PROJECT_UNAVAILABLE"
      );
    }
    return project;
  });
}

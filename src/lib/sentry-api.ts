import { ApiError } from "@/lib/api";

const SENTRY_API = "https://sentry.io/api/0/";
const REQUEST_TIMEOUT_MS = 10_000;

export type SentryConnection = { organizationSlug: string; token: string };

type SentryScope = "project:read" | "event:read";

type ErrorMessages = {
  notFound: string;
};

const invalidResponse = () => new ApiError(502, "Sentry returned an unexpected response.", "SENTRY_INVALID_RESPONSE");

function requiredScopesText(scopes: readonly SentryScope[]): string {
  return scopes.join(" and ");
}

export function mapSentryStatus(status: number, scopes: readonly SentryScope[], messages: ErrorMessages): ApiError {
  const scopeText = requiredScopesText(scopes);
  if (status >= 300 && status < 400) {
    return new ApiError(502, "Sentry redirected the request, which is not allowed.", "SENTRY_REDIRECT");
  }
  if (status === 401) {
    return new ApiError(400, `Sentry rejected the token. Check that it is valid and has ${scopeText} access.`, "SENTRY_AUTH");
  }
  if (status === 403) {
    return new ApiError(400, `The Sentry token does not have ${scopeText} access to this organization.`, "SENTRY_FORBIDDEN");
  }
  if (status === 404) {
    return new ApiError(400, messages.notFound, "SENTRY_NOT_FOUND");
  }
  if (status === 429) {
    return new ApiError(429, "Sentry is rate limiting this connection. Try again shortly.", "SENTRY_RATE_LIMIT");
  }
  return new ApiError(502, "Sentry is temporarily unavailable. Try again shortly.", "SENTRY_UNAVAILABLE");
}

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

function isAbortLikeError(error: unknown) {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function createRequestSignal(requestTimeoutMs: number, parentSignal?: AbortSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new DOMException("request timeout", "TimeoutError"));
  }, requestTimeoutMs);

  const onAbort = () => controller.abort(parentSignal?.reason ?? new DOMException("aborted", "AbortError"));
  if (parentSignal) {
    if (parentSignal.aborted) onAbort();
    else parentSignal.addEventListener("abort", onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      if (parentSignal && !parentSignal.aborted) parentSignal.removeEventListener("abort", onAbort);
    },
  };
}

export async function fetchSentryOrganizationPage(
  connection: SentryConnection,
  path: string,
  params: [string, string][],
  options: {
    scopes: readonly SentryScope[];
    errors: ErrorMessages;
    signal?: AbortSignal;
    requestTimeoutMs?: number;
  }
): Promise<{ body: unknown; cursor: string | null }> {
  const url = new URL(`organizations/${encodeURIComponent(connection.organizationSlug)}/${path}`, SENTRY_API);
  for (const [key, value] of params) url.searchParams.append(key, value);

  const { signal, cleanup } = createRequestSignal(options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS, options.signal);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${connection.token}`, Accept: "application/json" },
      redirect: "manual",
      cache: "no-store",
      signal,
    });
  } catch (error) {
    cleanup();
    if (isAbortLikeError(error)) {
      throw new ApiError(504, "Sentry took too long to respond. Try again shortly.", "SENTRY_TIMEOUT");
    }
    throw mapSentryStatus(0, options.scopes, options.errors);
  }

  if (response.type === "opaqueredirect") {
    cleanup();
    throw mapSentryStatus(302, options.scopes, options.errors);
  }
  if (!response.ok) {
    cleanup();
    throw mapSentryStatus(response.status, options.scopes, options.errors);
  }

  try {
    const body = await response.json();
    return { body, cursor: nextCursor(response.headers.get("link")) };
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new ApiError(504, "Sentry took too long to respond. Try again shortly.", "SENTRY_TIMEOUT");
    }
    throw invalidResponse();
  } finally {
    cleanup();
  }
}

export { invalidResponse };

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup as dnsLookup } from "node:dns";
import type { LookupFunction } from "node:net";
import { request as httpsRequest } from "node:https";
import { ApiError } from "@/lib/api";
import { deriveKey } from "@/lib/crypto";

export const GITLAB_SCOPES = "read_api read_user";
export const GITLAB_STATE_COOKIE = "gl_oauth_state";
export const GITLAB_CALLBACK_PATH = "/api/gitlab/callback";
const STATE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

type StatePayload = { ownerId: string; userId: string; baseUrl: string; expiresAt: number; nonce: string };
export type GitLabCredentials = { clientId: string; clientSecret: string };
export type GitLabTokenSet = { accessToken: string; refreshToken: string; expiresAt: Date; scopes: string };
export type GitLabRequestInit = { method?: string; headers?: Record<string, string>; body?: string };
export type GitLabRequester = (url: URL, init: GitLabRequestInit) => Promise<Response>;

function familyNumber(family: number | "IPv4" | "IPv6" | undefined): number {
  if (family === "IPv4") return 4;
  if (family === "IPv6") return 6;
  return family ?? 0;
}

function ipv4Number(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((value, part) => ((value << 8) | Number(part)) >>> 0, 0);
}

function inIPv4Range(value: number, network: string, bits: number): boolean {
  const base = ipv4Number(network);
  if (base === null) return true;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) >>> 0 === (base & mask) >>> 0;
}

function isPublicIPv4(address: string): boolean {
  const value = ipv4Number(address);
  if (value === null) return false;
  const nonPublic: [string, number][] = [
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
    ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
    ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
    ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
  ];
  return !nonPublic.some(([network, bits]) => inIPv4Range(value, network, bits));
}

function isPublicIPv6(address: string): boolean {
  if (address.includes("%")) return false;
  let input = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(input);
  if (mapped) return isPublicIPv4(mapped[1]);
  if (input.includes(".")) {
    const lastColon = input.lastIndexOf(":");
    const number = ipv4Number(input.slice(lastColon + 1));
    if (number === null) return false;
    input = `${input.slice(0, lastColon)}:${((number >>> 16) & 0xffff).toString(16)}:${(number & 0xffff).toString(16)}`;
  }
  const split = input.split("::");
  if (split.length > 2) return false;
  const left = split[0] ? split[0].split(":") : [];
  const right = split.length === 2 && split[1] ? split[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((split.length === 1 && missing !== 0) || (split.length === 2 && missing < 1)) return false;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return false;
  const first = Number.parseInt(groups[0], 16);
  const second = Number.parseInt(groups[1], 16);
  const globalUnicast = first >= 0x2000 && first <= 0x3fff;
  const documentation = first === 0x2001 && second === 0x0db8;
  const specialTransition = first === 0x2002 || (first === 0x2001 && second <= 0x01ff);
  return globalUnicast && !documentation && !specialTransition;
}

export function isPublicGitLabAddress(address: string): boolean {
  const value = address.replace(/^\[|\]$/g, "");
  if (value.includes(":")) return isPublicIPv6(value);
  return isPublicIPv4(value);
}

export function normalizeGitLabBaseUrl(input: string): string {
  const value = input.trim();
  if (value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value) || value.includes("\\") || value.includes("?") || value.includes("#")) {
    throw new ApiError(400, "Enter a valid public HTTPS GitLab URL.", "VALIDATION");
  }
  const rawPath = value.replace(/^https:\/\/[^/]+/i, "").split(/[?#]/, 1)[0];
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    throw new ApiError(400, "Enter a valid public HTTPS GitLab URL.", "VALIDATION");
  }
  if (decodedPath.includes("\\") || decodedPath.split("/").some((part) => part === "." || part === "..")) {
    throw new ApiError(400, "Enter a valid public HTTPS GitLab URL.", "VALIDATION");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(400, "Enter a valid public HTTPS GitLab URL.", "VALIDATION");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    (hostname.includes(":") || /^\d+(?:\.\d+){3}$/.test(hostname) ? !isPublicGitLabAddress(hostname) : false)
  ) {
    throw new ApiError(400, "Enter a valid public HTTPS GitLab URL.", "VALIDATION");
  }
  url.hostname = hostname;
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function buildGitLabAuthorizeUrl(baseUrl: string, clientId: string, state: string, redirectUri: string): string {
  const base = normalizeGitLabBaseUrl(baseUrl);
  const url = new URL(`${base}/oauth/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GITLAB_SCOPES);
  url.searchParams.set("state", state);
  return url.toString();
}

function stateSignature(payload: string): Buffer {
  return createHmac("sha256", deriveKey("gitlab-oauth-state")).update(payload).digest();
}

export function createGitLabState(ownerId: string, userId: string, baseUrl: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({
    ownerId,
    userId,
    baseUrl: normalizeGitLabBaseUrl(baseUrl),
    expiresAt: now + STATE_TTL_MS,
    nonce: randomBytes(32).toString("base64url"),
  } satisfies StatePayload)).toString("base64url");
  return `${payload}.${stateSignature(payload).toString("base64url")}`;
}

export function verifyGitLabState(
  received: string | null | undefined,
  cookie: string | null | undefined,
  ownerId: string,
  userId: string,
  baseUrl: string,
  now = Date.now()
): boolean {
  if (!received || !cookie) return false;
  if (received.length > 2048 || cookie.length > 2048) return false;
  const receivedBytes = Buffer.from(received);
  const cookieBytes = Buffer.from(cookie);
  if (receivedBytes.length !== cookieBytes.length || !timingSafeEqual(receivedBytes, cookieBytes)) return false;
  const [payload, signature, extra] = received.split(".");
  if (!payload || !signature || extra) return false;
  let given: Buffer;
  try {
    given = Buffer.from(signature, "base64url");
  } catch {
    return false;
  }
  const expected = stateSignature(payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  try {
    const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as StatePayload;
    return state.ownerId === ownerId && state.userId === userId && state.baseUrl === normalizeGitLabBaseUrl(baseUrl) && state.expiresAt > now;
  } catch {
    return false;
  }
}

export function parseGitLabTokenResponse(value: unknown, now = Date.now()): GitLabTokenSet {
  if (!value || typeof value !== "object") throw new ApiError(502, "GitLab returned an invalid token response.", "GITLAB_UNAVAILABLE");
  const token = value as Record<string, unknown>;
  if (
    typeof token.access_token !== "string" || !token.access_token ||
    typeof token.refresh_token !== "string" || !token.refresh_token ||
    typeof token.expires_in !== "number" || !Number.isFinite(token.expires_in) || token.expires_in <= 0 || token.expires_in > 366 * 24 * 60 * 60 ||
    (token.scope !== undefined && typeof token.scope !== "string") ||
    (token.created_at !== undefined && (typeof token.created_at !== "number" || !Number.isSafeInteger(token.created_at)))
  ) {
    throw new ApiError(502, "GitLab returned an invalid token response.", "GITLAB_UNAVAILABLE");
  }
  const createdAt = typeof token.created_at === "number" ? token.created_at * 1000 : now;
  const expiresAt = new Date(createdAt + token.expires_in * 1000);
  if (!Number.isFinite(expiresAt.getTime())) {
    throw new ApiError(502, "GitLab returned an invalid token response.", "GITLAB_UNAVAILABLE");
  }
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt,
    scopes: typeof token.scope === "string" ? token.scope : "",
  };
}

export function gitlabError(status: number): ApiError {
  if (status === 401) return new ApiError(400, "GitLab rejected the connection. Reconnect GitLab in Settings.", "GITLAB_AUTH");
  if (status === 403 || status === 404) return new ApiError(400, "GitLab denied access to a selected project.", "GITLAB_ACCESS");
  if (status === 429) return new ApiError(429, "GitLab is rate limiting this connection. Try again shortly.", "GITLAB_RATE_LIMIT");
  return new ApiError(502, "GitLab is temporarily unavailable. Try again shortly.", "GITLAB_UNAVAILABLE");
}

export function createPublicGitLabLookup(resolver: LookupFunction = dnsLookup): LookupFunction {
  return (hostname, options, callback) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      const error = Object.assign(new Error("GitLab DNS lookup timed out."), { code: "ETIMEDOUT" });
      callback(error, options.all ? [] : "", 0);
    }, REQUEST_TIMEOUT_MS);
    timer.unref();
    resolver(hostname, { all: true, verbatim: true, ...(options.family ? { family: options.family } : {}) }, (error, result, family) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) return callback(error, options.all ? [] : "", 0);
      const addresses: { address: string; family: number }[] = Array.isArray(result)
        ? result.map((entry) => ({ address: entry.address, family: familyNumber(entry.family) }))
        : typeof result === "string"
          ? [{ address: result, family: familyNumber(family ?? options.family) }]
          : [];
      if (!addresses.length || addresses.some((entry) => !isPublicGitLabAddress(entry.address))) {
        const denied = Object.assign(new Error("GitLab host resolved to a non-public address."), { code: "EACCES" });
        return callback(denied, options.all ? [] : "", 0);
      }
      if (options.all) return callback(null, addresses);
      const requestedFamily = familyNumber(options.family);
      const address = addresses.find((entry) => !requestedFamily || entry.family === requestedFamily);
      if (!address) {
        const unavailable = Object.assign(new Error("GitLab host has no address for the requested family."), { code: "ENOTFOUND" });
        return callback(unavailable, "", 0);
      }
      return callback(null, address.address, address.family);
    });
  };
}

type HttpsSender = GitLabRequester;
const lookupPublic = createPublicGitLabLookup();

async function secureHttpsRequest(url: URL, init: GitLabRequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      method: init.method ?? "GET",
      headers: init.headers,
      lookup: lookupPublic,
      servername: url.hostname.replace(/^\[|\]$/g, ""),
      timeout: REQUEST_TIMEOUT_MS,
    }, (response) => {
      const status = response.statusCode ?? 502;
      if (status >= 300 && status < 400) {
        clearTimeout(timer);
        response.destroy();
        reject(new ApiError(502, "GitLab redirected a request; the redirect was blocked.", "GITLAB_REDIRECT"));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_RESPONSE_BYTES) {
          request.destroy(new ApiError(502, "GitLab response exceeded the size limit.", "GITLAB_UNAVAILABLE"));
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => {
        clearTimeout(timer);
        resolve(new Response(Buffer.concat(chunks), { status, headers: response.headers as HeadersInit }));
      });
      response.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    const timer = setTimeout(() => request.destroy(new DOMException("GitLab request timed out.", "TimeoutError")), REQUEST_TIMEOUT_MS);
    timer.unref();
    request.on("timeout", () => request.destroy(new DOMException("GitLab request timed out.", "TimeoutError")));
    request.on("error", (error) => {
      clearTimeout(timer);
      if (error instanceof ApiError) return reject(error);
      if (error.name === "TimeoutError") return reject(new ApiError(504, "GitLab took too long to respond.", "GITLAB_TIMEOUT"));
      reject(new ApiError(502, "Could not reach GitLab. Check the instance URL and try again.", "GITLAB_UNAVAILABLE"));
    });
    if (init.body) request.write(init.body);
    request.end();
  });
}

export async function requestGitLab(
  baseUrl: string,
  path: string,
  init: GitLabRequestInit = {},
  sender: HttpsSender = secureHttpsRequest
): Promise<Response> {
  const base = normalizeGitLabBaseUrl(baseUrl);
  if (!path.startsWith("/") || path.startsWith("//")) throw new ApiError(400, "Invalid GitLab API path.", "VALIDATION");
  const rawPath = path.split("?", 1)[0];
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    throw new ApiError(400, "Invalid GitLab API path.", "VALIDATION");
  }
  if (
    /[\u0000-\u001f\u007f]/.test(path) ||
    decodedPath.includes("\\") ||
    decodedPath.split("/").some((part) => part === "." || part === ".." || part.includes("/")) ||
    !(decodedPath === "/oauth/token" || decodedPath === "/api/v4" || decodedPath.startsWith("/api/v4/"))
  ) {
    throw new ApiError(400, "Invalid GitLab API path.", "VALIDATION");
  }
  let url: URL;
  try {
    url = new URL(`${base}${path}`);
  } catch {
    throw new ApiError(400, "Invalid GitLab API path.", "VALIDATION");
  }
  if (url.origin !== new URL(base).origin || url.username || url.password) throw new ApiError(400, "Invalid GitLab API path.", "VALIDATION");
  try {
    const response = await sender(url, { ...init, headers: { Accept: "application/json", ...init.headers } });
    if (response.status >= 300 && response.status < 400) {
      throw new ApiError(502, "GitLab redirected a request; the redirect was blocked.", "GITLAB_REDIRECT");
    }
    return response;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "TimeoutError") throw new ApiError(504, "GitLab took too long to respond.", "GITLAB_TIMEOUT");
    throw new ApiError(502, "Could not reach GitLab. Try again shortly.", "GITLAB_UNAVAILABLE");
  }
}

export async function gitlabJson<T>(baseUrl: string, path: string, token: string, sender?: HttpsSender): Promise<T> {
  const response = await requestGitLab(baseUrl, path, { headers: { Authorization: `Bearer ${token}` } }, sender);
  if (!response.ok) throw gitlabError(response.status);
  try {
    return await response.json() as T;
  } catch {
    throw new ApiError(502, "GitLab returned an invalid response.", "GITLAB_UNAVAILABLE");
  }
}

async function exchangeToken(
  baseUrl: string,
  credentials: GitLabCredentials,
  body: URLSearchParams,
  sender?: HttpsSender
): Promise<GitLabTokenSet> {
  body.set("client_id", credentials.clientId);
  body.set("client_secret", credentials.clientSecret);
  const response = await requestGitLab(baseUrl, "/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  }, sender);
  if (!response.ok) {
    if (response.status === 400 || response.status === 401) {
      throw new ApiError(400, "GitLab rejected the OAuth credentials or token. Reconnect GitLab in Settings.", "GITLAB_AUTH");
    }
    throw gitlabError(response.status);
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(502, "GitLab returned an invalid token response.", "GITLAB_UNAVAILABLE");
  }
  return parseGitLabTokenResponse(data);
}

export function exchangeGitLabCode(
  baseUrl: string,
  credentials: GitLabCredentials,
  code: string,
  redirectUri: string,
  sender?: HttpsSender
): Promise<GitLabTokenSet> {
  return exchangeToken(baseUrl, credentials, new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }), sender);
}

export function refreshGitLabToken(
  baseUrl: string,
  credentials: GitLabCredentials,
  refreshToken: string,
  sender?: HttpsSender
): Promise<GitLabTokenSet> {
  return exchangeToken(baseUrl, credentials, new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }), sender);
}
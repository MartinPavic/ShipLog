import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { deriveKey } from "@/lib/crypto";

const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 64;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const ACCESS_COOKIE = "shiplog_share_access";
export const ACCESS_TTL_SEC = 24 * 60 * 60;

export const createShareToken = () => randomBytes(32).toString("base64url");
export const isShareToken = (value: string) => TOKEN_RE.test(value);

function scryptAsync(password: string, salt: Buffer, params: typeof SCRYPT, keyLen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLen, { ...params, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}

// Format: scrypt$N$r$p$salt$hash (salt and hash base64url).
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, SCRYPT, KEY_LEN);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scryptAsync(
    password,
    Buffer.from(salt, "base64url"),
    { N: Number(n), r: Number(r), p: Number(p) },
    expected.length
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const fingerprint = (passwordHash: string) => createHash("sha256").update(passwordHash).digest("base64url").slice(0, 16);

function signature(token: string, passwordHash: string, expiresAt: number): string {
  return createHmac("sha256", deriveKey("shiplog:share-access"))
    .update(`${token}.${fingerprint(passwordHash)}.${expiresAt}`)
    .digest("base64url");
}

// The signature covers the password hash, so changing or removing the password revokes old cookies.
export function signAccess(token: string, passwordHash: string, now = Date.now()): string {
  const expiresAt = Math.floor(now / 1000) + ACCESS_TTL_SEC;
  return `${expiresAt}.${signature(token, passwordHash, expiresAt)}`;
}

export function verifyAccess(cookie: string | undefined, token: string, passwordHash: string, now = Date.now()): boolean {
  if (!cookie) return false;
  const [exp, sig] = cookie.split(".");
  const expiresAt = Number(exp);
  if (!sig || !Number.isInteger(expiresAt) || expiresAt * 1000 < now) return false;
  const expected = Buffer.from(signature(token, passwordHash, expiresAt));
  const received = Buffer.from(sig);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

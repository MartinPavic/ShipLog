import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createShareToken,
  hashPassword,
  isShareToken,
  signAccess,
  verifyAccess,
  verifyPassword,
  ACCESS_TTL_SEC,
} from "./share";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("share tokens", () => {
  it("are 43 url-safe characters and unique", () => {
    const a = createShareToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isShareToken(a)).toBe(true);
    expect(createShareToken()).not.toBe(a);
  });

  it.each(["", "short", "a".repeat(42), "a".repeat(44), `${"a".repeat(42)}/`, `${"a".repeat(42)}.`])(
    "rejects malformed %j",
    (value) => {
      expect(isShareToken(value)).toBe(false);
    }
  );
});

describe("passwords", () => {
  it("round-trips and uses a random salt", async () => {
    const hash = await hashPassword("correct horse");
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(hash).not.toContain("correct horse");
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
    expect(await hashPassword("correct horse")).not.toBe(hash);
  });

  it("rejects malformed hashes instead of throwing", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$a$b$c$d$e")).toBe(false);
  });
});

describe("access cookies", () => {
  const token = createShareToken();
  const now = Date.now();

  it("verify for the same token and password hash", () => {
    const cookie = signAccess(token, "hash-1", now);
    expect(verifyAccess(cookie, token, "hash-1", now)).toBe(true);
  });

  it("are bound to the token", () => {
    expect(verifyAccess(signAccess(token, "hash-1", now), createShareToken(), "hash-1", now)).toBe(false);
  });

  it("stop working when the password changes or is removed", () => {
    const cookie = signAccess(token, "hash-1", now);
    expect(verifyAccess(cookie, token, "hash-2", now)).toBe(false);
  });

  it("expire", () => {
    const cookie = signAccess(token, "hash-1", now);
    expect(verifyAccess(cookie, token, "hash-1", now + (ACCESS_TTL_SEC - 5) * 1000)).toBe(true);
    expect(verifyAccess(cookie, token, "hash-1", now + (ACCESS_TTL_SEC + 5) * 1000)).toBe(false);
  });

  it("reject tampering and garbage", () => {
    const [exp, sig] = signAccess(token, "hash-1", now).split(".");
    expect(verifyAccess(`${Number(exp) + 99999}.${sig}`, token, "hash-1", now)).toBe(false);
    expect(verifyAccess(`${exp}.${sig.slice(0, -1)}x`, token, "hash-1", now)).toBe(false);
    for (const junk of [undefined, "", "abc", "1.", ".sig", "NaN.sig"]) {
      expect(verifyAccess(junk, token, "hash-1", now)).toBe(false);
    }
  });
});

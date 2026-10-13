import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { decrypt, encrypt, last4, maskSecret } from "./crypto";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("crypto", () => {
  it("round-trips", () => {
    const secret = "ghp_example_token";
    expect(decrypt(encrypt(secret))).toBe(secret);
  });

  it("uses a fresh IV each time", () => {
    expect(encrypt("a")).not.toBe(encrypt("a"));
  });

  it("rejects tampered payloads", () => {
    const parts = encrypt("secret").split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });

  it("masks keeping last 4", () => {
    expect(maskSecret(last4("sk-abcdef1234"))).toBe("••••••••1234");
  });
});

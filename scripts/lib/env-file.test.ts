import { describe, expect, it } from "vitest";
import { parseEnv, randomSecret, setEnvValue } from "./env-file";

describe("parseEnv", () => {
  it("reads plain, quoted and exported values, ignoring comments and blanks", () => {
    const env = parseEnv(
      ["# comment", "", "A=1", "export B=two", 'C="with space"', "D='single # kept'", "E=bare # trailing", "F=", "  G = spaced "].join("\n")
    );
    expect(env).toEqual({ A: "1", B: "two", C: "with space", D: "single # kept", E: "bare", F: "", G: "spaced" });
  });

  it("handles Windows line endings and escaped quotes", () => {
    expect(parseEnv('A=1\r\nB="say \\"hi\\""\r\n')).toEqual({ A: "1", B: 'say "hi"' });
  });

  it("ignores lines that are not assignments", () => {
    expect(parseEnv("not an assignment\n#X=1\n=oops")).toEqual({});
  });
});

describe("setEnvValue", () => {
  it("replaces an existing assignment and leaves the rest untouched", () => {
    const text = "# head\nA=old\nB=keep\n";
    expect(setEnvValue(text, "A", "new")).toBe("# head\nA=new\nB=keep\n");
  });

  it("uncomments an example line in place", () => {
    expect(setEnvValue("X=1\n# AI_PROVIDER=mock\nY=2\n", "AI_PROVIDER", "live")).toBe("X=1\nAI_PROVIDER=live\nY=2\n");
  });

  it("prefers the active line over a commented one", () => {
    expect(setEnvValue("# K=example\nK=real\n", "K", "v")).toBe("# K=example\nK=v\n");
  });

  it("appends missing keys, adding a newline when the file has none", () => {
    expect(setEnvValue("A=1", "B", "2")).toBe("A=1\nB=2\n");
    expect(setEnvValue("A=1\n", "B", "2")).toBe("A=1\nB=2\n");
    expect(setEnvValue("", "B", "2")).toBe("B=2\n");
  });

  it("quotes values that need it and round-trips them", () => {
    const value = 'App "Name" <noreply@example.com> # not a comment';
    const text = setEnvValue("", "RESEND_FROM", value);
    expect(text.startsWith('RESEND_FROM="')).toBe(true);
    expect(parseEnv(text).RESEND_FROM).toBe(value);
  });

  it("keeps base64 secrets unquoted and round-trips URLs with query strings", () => {
    expect(setEnvValue("", "K", "ab+/cd==")).toBe("K=ab+/cd==\n");
    const url = "postgres://u:p@host:5432/db?sslmode=require&channel_binding=require";
    expect(parseEnv(setEnvValue("", "U", url)).U).toBe(url);
  });

  it("does not treat $ sequences in a value as replacement patterns", () => {
    expect(parseEnv(setEnvValue("K=1\n", "K", "a$&b$1")).K).toBe("a$&b$1");
  });

  it("does not touch keys that merely share a prefix", () => {
    expect(setEnvValue("DATABASE_URL_UNPOOLED=x\n", "DATABASE_URL", "y")).toBe("DATABASE_URL_UNPOOLED=x\nDATABASE_URL=y\n");
  });
});

describe("randomSecret", () => {
  it("returns base64 of the requested size, different each time", () => {
    expect(Buffer.from(randomSecret(32), "base64")).toHaveLength(32);
    expect(randomSecret(24)).not.toBe(randomSecret(24));
  });
});

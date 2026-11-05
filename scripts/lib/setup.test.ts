import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertCommandSucceeded, savePrivateEnv, securePrivateEnv } from "./setup";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe("savePrivateEnv", () => {
  it("tightens permissions when updating an existing env file", () => {
    const directory = mkdtempSync(join(tmpdir(), "shiplog-env-"));
    directories.push(directory);
    const file = join(directory, ".env.local");
    writeFileSync(file, "OLD=value\n", { mode: 0o644 });
    chmodSync(file, 0o644);

    savePrivateEnv(file, "SECRET=value\n");

    expect(readFileSync(file, "utf8")).toBe("SECRET=value\n");
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("secures an existing env file even when no values are rewritten", () => {
    const directory = mkdtempSync(join(tmpdir(), "shiplog-env-"));
    directories.push(directory);
    const file = join(directory, ".env.local");
    writeFileSync(file, "SECRET=value\n", { mode: 0o644 });
    chmodSync(file, 0o644);

    securePrivateEnv(file);

    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});

describe("assertCommandSucceeded", () => {
  it("reports failed child processes instead of allowing setup to finish", () => {
    expect(() => assertCommandSucceeded("seed", { status: 1 })).toThrow("seed failed with status 1");
    expect(() => assertCommandSucceeded("seed", { status: null, error: new Error("not found") })).toThrow(
      "Could not run seed: not found"
    );
    expect(() => assertCommandSucceeded("seed", { status: 0 })).not.toThrow();
  });
});
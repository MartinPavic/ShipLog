import { chmodSync, writeFileSync } from "node:fs";

export function savePrivateEnv(path: string, text: string): void {
  writeFileSync(path, text, { mode: 0o600 });
  securePrivateEnv(path);
}

export function securePrivateEnv(path: string): void {
  chmodSync(path, 0o600);
}

export function assertCommandSucceeded(command: string, result: { status: number | null; error?: Error }): void {
  if (result.error) throw new Error(`Could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status ?? "unknown"}.`);
}
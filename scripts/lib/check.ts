import { validateEnv, type EnvReport } from "../../src/env";

export const MIN_NODE = { major: 22, minor: 12 };

export function nodeSupported(version: string): boolean {
  const [major = 0, minor = 0] = version.replace(/^v/, "").split(".").map(Number);
  return major > MIN_NODE.major || (major === MIN_NODE.major && minor >= MIN_NODE.minor);
}

export function checkEnvironment(
  env: Record<string, string | undefined>,
  { production, nodeVersion }: { production: boolean; nodeVersion: string }
): EnvReport {
  const report = validateEnv(env, production);
  if (!nodeSupported(nodeVersion)) {
    report.errors.unshift(`Node.js ${MIN_NODE.major}.${MIN_NODE.minor} or newer is required (found ${nodeVersion}).`);
  }
  return report;
}

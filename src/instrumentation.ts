import { formatEnvReport, validateEnv } from "@/env";

// Runs once when the server starts. A misconfigured production deployment fails here, with every
// problem listed, instead of surfacing as an obscure error on the first request.
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // `next build` evaluates the app without a real environment.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const report = validateEnv();
  if (report.errors.length === 0 && report.warnings.length === 0) return;

  const text = formatEnvReport(report);
  if (report.errors.length > 0 && process.env.NODE_ENV === "production") {
    throw new Error(`\n${text}\n\nSee .env.example and the README.`);
  }
  console.warn(`\n${text}\n`);
}

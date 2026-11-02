# Dashboard Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make project selection, generation, and review the primary dashboard workflow.

**Architecture:** Keep server-side dashboard loading and existing generation APIs. QuickGenerate owns local project selection and its remembered cookie; ProjectGenerate remains shared with project pages. Reuse the existing report page for review and sharing.

**Tech Stack:** Next.js 16.4.2, React 19.2.8, TypeScript, Base UI, Tailwind CSS, Vitest 5 with node/server-rendering tests.

**Spec:** [Approved design](../specs/2026-10-30-dashboard-workflow-design.md).

## Global Constraints

- No new dependencies, integrations, database changes, approval statuses, or visual rebrand.
- Preserve setup, billing, organization permissions, checkout feedback, generation failures, cancellation, quotas, and feature flags.
- Preserve existing user edits and keep temporary preview session data out of commits.
- Do not run database-writing tests against an unverified shared environment.
- Read relevant installed Next.js documentation before modifying framework-dependent code. Do not commit or create branches without a user request.

## Review Focus

- Empty projects: onboarding and a projects link remain available without rendering a broken generator.
- Missing or stale remembered project: resolve only against the current owner's available projects.
- One project or changed project: show the field and load the correct template and period defaults.
- Missing setup or unavailable billing: preserve blockers and avoid inappropriate billing actions.
- Generating or failed reports: do not present them as successfully ready for sharing.

### Task 1: Local Project Selection And Header Cleanup

**Files:** Modify src/components/quick-generate.tsx and src/app/dashboard/layout.tsx; remove unused src/components/project-switcher.tsx after verifying references; create src/components/quick-generate.test.tsx and src/app/dashboard-layout.test.tsx.

**Interfaces:** Keep QuickGenerate's projects, templates, initialProjectId, usage, and setupMessage inputs. Preserve PROJECT_COOKIE = active_project and current cookie lifetime/path/SameSite settings. Keep ProjectGenerate's keyed project remount and defaults.

- [x] Add failing tests for a visible, associated Project label with one project; valid remembered selection; fallback from an unavailable initial ID; selected-project defaults; absence of the header picker; preserved workspace/account controls. Mock dependencies and capture select handlers to test switching without adding a DOM library.
- [x] Run `npm test -- src/components/quick-generate.test.tsx src/app/dashboard-layout.test.tsx`; confirm failures describe the requested behavior.
- [x] Always render the labeled picker, persist valid selections through the existing cookie, and remove header selector wiring and its now-unneeded listProjects query. Keep organization-plan behavior intact.
- [x] Rerun the same tests; expect all passing.

### Task 2: Dashboard Hierarchy

**Files:** Modify src/app/dashboard/page.tsx, src/components/quick-generate.tsx, and src/components/project-generate.tsx; create src/app/dashboard-workflow.test.tsx; update affected assertions in src/app/dashboard-page.test.tsx.

**Interfaces:** Preserve getDashboardData's result and all generation request contracts. If needed, add an optional presentation prop to ProjectGenerate with its existing project-page presentation as the default. Do not change project-page callers unless necessary for compatibility.

- [x] Add failing database-independent tests with mocked dashboard data: generation precedes recent reports; compact account information follows; zero projects preserve onboarding and the projects link; setup blockers remain; ready/failed/generating states remain distinct; stale cookies fall back; checkout and non-admin billing behavior remain correct.
- [x] Run `npm test -- src/app/dashboard-workflow.test.tsx src/components/quick-generate.test.tsx src/app/dashboard-layout.test.tsx`; confirm expected failures.
- [x] Replace the four leading statistics cards with compact trailing account information, make generation the main action, preserve relevant onboarding and feedback, and avoid duplicated dashboard quota UI or nested decorative cards. Keep the existing visual language and responsive controls.
- [x] Update existing database test assertions for intentionally changed copy/ordering without weakening behavior checks. Do not execute those tests without an explicitly disposable database.
- [x] Rerun the database-independent tests; expect all passing.

### Task 3: Review Handoff And Verification

**Files:** Modify src/components/project-generate.tsx and src/app/dashboard/page.tsx; create src/components/project-generate.test.tsx; extend src/app/dashboard-workflow.test.tsx.

**Interfaces:** Review and share links continue to use /dashboard/projects/{projectId}/logs/{logId}; no new API or sharing behavior.

- [x] Add failing tests for the generated result's Review and share link and its exact destination; successful recent reports show that action; unsuccessful reports retain status and navigation without claiming sharing readiness. Mock client generation and component state as needed using existing Vitest facilities.
- [x] Run `npm test -- src/components/project-generate.test.tsx src/app/dashboard-workflow.test.tsx`; confirm expected failures.
- [x] Update result and recent-report actions without altering streaming, source inspection, regeneration, cancellation, or error handling.
- [x] Rerun all four new test files and src/components/dashboard-components.test.tsx; expect passing. Run `npm run typecheck` and scoped ESLint for touched source and test files; resolve new errors.
- [x] Review the final diff and diagnostics. Start the local app on a free port, report its URL, and inspect authenticated desktop/mobile behavior if browser/auth tooling is available; otherwise state that visual behavior remains unverified. Run broader checks only when they cannot write to an unverified database. Obtain one independent review of the completed diff.

## Verification Results

- 24 tests passed across the five focused files; TypeScript, scoped ESLint, editor diagnostics, and diff whitespace checks passed.
- Independent review identified a keyboard-focus regression on project changes. Reproduced and fixed; real headless Chrome now verifies selection, updated defaults, remembered cookie, and retained focus. Follow-up review approved the fix.
- The app runs at http://localhost:3000; browser-style dashboard requests enter Clerk's normal authentication handshake.
- Authenticated desktop/mobile dashboard screenshots and database-writing tests remain unverified. No dependencies, migrations, commits, or branches were added.
# Quick Generate Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve dashboard Quick generate hierarchy while preserving Shiplog's deep-sea/brass visual identity and existing generation behavior.

**Architecture:** Use the existing `projectField` compact-form path in `ProjectGenerate` to scope the redesign to the dashboard. Keep the project-page Card presentation and generation contract unchanged; reuse the current field components and Tailwind tokens.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-11-quick-generate-redesign-design.md`

## Global Constraints

- Do not change the project-page generator or generation behavior.
- Do not add dependencies, usage/billing details, or a full dashboard redesign.
- Preserve project cookie selection, focus restoration, validation, setup blockers, loading, cancellation, and errors.
- Keep labels and accessible control associations intact; stack fields on narrow screens.

## Review Focus

- Date-range mode: From and To fields replace the day count while staying grouped with Period; add a test rendering with mode set to `range` and asserting From/To are present and Days is absent.
- Invalid day counts: Generate remains disabled outside 1–90; add a test with `defaultDays: 0` and assert the Generate button is disabled.
- Project-page rendering: standalone card, title, and quota remain unchanged; keep the existing presentation test.
- Setup blocker: project picker remains visible while other generation controls stay absent; add a compact-mode setup-blocker assertion.
- Generation contract: generated request remains unchanged; retain the existing request assertion.

---

### Task 1: Dashboard Compact Generator Layout

**Files:**
- Modify: `src/components/project-generate.tsx`
- Test: `src/components/project-generate.test.tsx`

**Interfaces:**
- Consumes the existing optional `projectField` prop to distinguish dashboard compact rendering from project-page rendering.
- Produces no new public API; preserves `ProjectGenerate` props and the current `GenerateRequest` payload.

- [ ] **Step 1: Add failing compact-layout regression tests**

In `src/components/project-generate.test.tsx`, add tests that render with `projectField` and assert Project precedes Template; Period, its selector, and Days share the compact period group; range mode shows From/To instead of Days; an out-of-range day count disables Generate; and a setup blocker keeps the project picker while hiding generation controls. Retain the project-page presentation test asserting its existing Card and heading.

- [ ] **Step 2: Run the focused test and confirm it fails for missing compact layout structure**

Run: `npx vitest run src/components/project-generate.test.tsx`
Expected: new compact-layout assertions fail; existing behavior tests pass.

- [ ] **Step 3: Implement the compact layout in `src/components/project-generate.tsx`**

Add styling and grouping only on the `projectField` path: use the existing dark-theme/card and brass tokens, put Project first, group the Period selector with its active day-count or date-range fields, and align Generate at the end. Use responsive grid classes so fields stack on small viewports. Keep the project-page path and all state, labels, handlers, and validation logic intact.

- [ ] **Step 4: Run focused component tests**

Run: `npx vitest run src/components/project-generate.test.tsx src/components/quick-generate.test.tsx`
Expected: all tests pass, including the compact layout and unchanged project selection/default behavior.

- [ ] **Step 5: Run TypeScript validation**

Run: `npm run typecheck`
Expected: completes successfully with no type errors.

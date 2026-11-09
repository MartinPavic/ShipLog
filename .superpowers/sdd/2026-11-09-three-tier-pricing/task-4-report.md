Status: completed
Commit SHA/subject: 294f4e4 Implement three-card pricing selector and variant checkout payloads
Test summary:
- `npm test -- src/app/landing.test.tsx src/app/rebrand.test.tsx src/lib/plans.test.ts` passed (3 files, 30 tests).
- `npm run typecheck` passed.
Concerns:
- Default selector mode was materially unspecified; implemented as BYOK by default to surface the lower paid price first.
Report path: .superpowers/sdd/2026-11-09-three-tier-pricing/task-4-report.md

---

Task 4 review-fix round (C1/I1/I2)

RED evidence:
- `npm test -- src/app/landing.test.tsx src/components/pricing-section.test.tsx` failed.
- Failing signals captured:
	- `landing.test.tsx`: expected managed selector to disappear when `MANAGED_AI_ENABLED=false`, but `Managed AI` still rendered.
	- `pricing-section.test.tsx`: new server-data API (`pricingSectionContent`) missing before implementation.

GREEN evidence:
- `npm test -- src/app/landing.test.tsx src/components/pricing-section.test.tsx` passed.
- `npm test -- src/app/landing.test.tsx src/app/rebrand.test.tsx src/components/pricing-section.test.tsx` passed (3 files, 22 tests).
- `npm run typecheck` passed.
- Production build passed with local test env overrides and no live DB usage:
	- `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:63028/postgres`
	- `DATABASE_URL_UNPOOLED=postgresql://postgres:postgres@127.0.0.1:63028/postgres`
	- test `ENCRYPTION_KEY` and non-production placeholders for required keys
	- `npm run build` completed successfully.

Scope notes:
- Fixed C1 by moving pricing copy/highlight computation to server (`pricingSectionContent`) and passing plain props to the client pricing selector.
- Added interaction tests for mode switching and signed-in checkout payload variants `{ tier, aiMode }` for Pro/Ultra in both BYOK and Managed modes.
- Fixed I2 by hiding the Managed selector and forcing BYOK pricing/copy when `MANAGED_AI_ENABLED=false`.
- Minor practical cleanups included in scope: shared pricing copy now derives from enabled capabilities; signed-in footer copy reworded to avoid subscriber-only implication.

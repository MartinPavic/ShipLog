# Quick Generate Redesign

## Intent
Make dashboard Quick generate feel more considered and current without losing Shiplog's established visual identity. The approved visual direction is the Field notes layout with the app's deep-sea palette, serif heading, and brass accent.

## Goals
- Improve hierarchy and grouping in the dashboard generator.
- Keep project selection prominent; group period mode with its day count or date-range fields.
- Preserve the existing setup, generation, validation, loading, cancellation, and error behavior.
- Keep the form responsive and use existing design tokens and UI components.

## Non-goals
- Do not rebrand the app or redesign the full dashboard.
- Do not change the project-page generator or generation behavior.
- Do not add dependencies or usage/billing details to the form.

## Approaches
1. Restyle only the dashboard's compact generator path, keeping the project-page generator unchanged. Selected: it directly addresses the screenshot and limits regression risk.
2. Restyle the shared generator everywhere. Rejected: broader scope than requested and changes the project workflow too.
3. Redesign the wider dashboard section. Rejected: the request is specifically about Quick generate.

## Design
Retain the dashboard's existing Quick generate heading and deep-sea/brass styling. Use a restrained outlined form surface with the project field first, then template and period controls. Place the numeric day input alongside the period selector; when Date range is selected, keep the existing From/To inputs grouped with that selector. Align Generate at the end of the form. Stack fields on narrow screens. Keep labels, keyboard behavior, and accessible control associations intact.

## Constraints and Builder Decisions
Implement through the existing `projectField` compact-form path in `ProjectGenerate`, so the standalone project generator remains unchanged. Reuse existing inputs, selects, buttons, and CSS tokens. Preserve current focus restoration, project cookie selection, date validation, and all generation states. Add focused regression coverage for the dashboard compact layout and retain the existing project generator behavior.
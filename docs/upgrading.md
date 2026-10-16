# Upgrading

Releases are tagged with semantic versions. [CHANGELOG.md](../CHANGELOG.md) lists what changed and flags anything that
needs action.

## Before you start

1. Read the changelog entries between your version and the new one. Look for "Breaking" and "Migration" notes.
2. Commit your work, so the upgrade is one reviewable change.
3. Know which files you changed that are meant to be yours: `src/config/site.ts`, `src/lib/plans.ts`, the legal
   pages, templates and anything under `public/`. These are the likeliest to conflict.

## Steps

1. Bring the new version's files in. If you keep a copy of the original release in Git (for example on a `vendor`
   branch), merge the new release into your branch. Otherwise unpack the new release next to your project and compare
   the two folders with your diff tool, keeping your customizations.
2. `npm install` to pick up dependency changes.
3. Read any new files in `drizzle/`, then run `npm run db:migrate` against each database. Migrations that were already applied are skipped.
4. `npm run setup -- --check --production` to catch new required variables. The changelog lists them too.
5. `npm run typecheck && npm run lint && npm test && npm run build`.
6. Deploy.

## Tips

- Keep your changes small and in the files above, and put new behavior in new files. That makes the next upgrade a
  cleaner merge.
- Add your own migrations after the shipped ones, never edit shipped ones.

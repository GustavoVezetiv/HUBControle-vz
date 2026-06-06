# Codex Technical Change Log

This file is maintained by project-local Codex hooks.

## 2026-06-06T01:02:50.344Z - codex/test8-reimbursements-import-preview

Objective: update project documentation

Files changed:
- `README.md`

Impact: documentation or metadata only

Risk: low

Validation: `not run` - no code, config, migration, or script changes detected

Documentation: covered by changed files or not required

Generated real estate intake files:
- _none_

Skipped from auto-commit because they were dirty before the turn:
- `eslint.config.mjs`
- `scripts/import-planned-purchases-from-xlsx.mjs`
- `src/features/goals/components/goals-crud.tsx`
- `src/features/goals/queries.ts`
- `src/features/imports/components/imports-workbench.tsx`
- `src/features/imports/import-engine.ts`
- `src/features/imports/parser.ts`
- `src/features/imports/queries.ts`
- `src/features/imports/templates.ts`
- `src/features/imports/types.ts`
- `src/lib/supabase/types.ts`
- `supabase/migrations/202606050001_goal_quality_and_import_batches.sql`

Skipped binary/PDF assets from auto-commit:
- _none_

Rollback: restore listed files from Git or from local snapshots in `.codex/backups`; after an automatic commit, use `git revert <commit>`.

## 2026-06-06T00:38:48.892Z - codex/test8-reimbursements-import-preview

Objective: update project documentation

Files changed:
- _none_

Impact: documentation or metadata only

Risk: low

Validation: `not run` - no code, config, migration, or script changes detected

Documentation: covered by changed files or not required

Generated real estate intake files:
- _none_

Skipped from auto-commit because they were dirty before the turn:
- `scripts/import-planned-purchases-from-xlsx.mjs`

Skipped binary/PDF assets from auto-commit:
- _none_

Rollback: restore listed files from Git or from local snapshots in `.codex/backups`; after an automatic commit, use `git revert <commit>`.

## 2026-06-04 - Configure Codex hooks

Objective: configure safe, project-local Codex hooks for backups, validation,
technical summaries, documentation prompts, real estate PDF/image intake, and
local auto-commit after successful validation.

Files changed:

- `.codex/hooks.json`
- `.codex/hooks/lib.mjs`
- `.codex/hooks/user-prompt-submit.mjs`
- `.codex/hooks/pre-tool-use-backup.mjs`
- `.codex/hooks/pre-tool-use-safety.mjs`
- `.codex/hooks/stop-quality-gate.mjs`
- `.gitignore`
- `AGENTS.md`
- `README.md`
- `docs/CODEX_HOOKS.md`
- `docs/CODEX_CHANGELOG.md`
- `docs/imobiliaria/README.md`
- `docs/imobiliaria/inbox/.gitkeep`
- `docs/imobiliaria/outputs/.gitkeep`
- `docs/imobiliaria/pendencias/.gitkeep`
- `scripts/organize-real-estate-availability.mjs`

Impact:

- Codex can load repo-local lifecycle hooks after this project layer is trusted.
- Edit/write tool calls get local timestamped snapshots under `.codex/backups/`.
- Code changes are validated with the detected minimum command, currently
  `npm run lint`.
- Automatic commits are local only, skip protected branches, skip files dirty at
  turn start, skip raw PDF/image assets, and never push.
- Real estate availability PDFs/images get an intake note and a normalizer script
  for copyable Markdown output.

Risk:

- Low to medium. The hooks alter local Codex workflow behavior, but generated
  backups/state are ignored by Git and auto-commit is gated by validation and
  branch checks.
- Project-local hooks must be reviewed and trusted with `/hooks`; until then,
  Codex may skip them.

Validation executed:

- `node --check` for all new `.mjs` hook and helper scripts: passed.
- `npm run lint`: passed.

Rollback:

- Revert the commit that introduced this hook setup.
- For uncommitted local edits, restore from Git or from timestamped snapshots in
  `.codex/backups/`.

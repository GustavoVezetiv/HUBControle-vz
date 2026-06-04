# Codex Project Hooks

This project has repo-local Codex hooks under `.codex/`. They only run after the
project `.codex/` layer is trusted by Codex. In the CLI, use `/hooks` to review
and trust new or changed hook definitions.

## Where the hooks live

- `.codex/hooks.json`: registers the lifecycle hooks.
- `.codex/hooks/user-prompt-submit.mjs`: records the dirty worktree baseline at
  the start of a user request.
- `.codex/hooks/pre-tool-use-backup.mjs`: creates a timestamped local backup
  before edit/write tool calls. Backups are stored in `.codex/backups/` and are
  never overwritten.
- `.codex/hooks/pre-tool-use-safety.mjs`: blocks automatic pushes, destructive
  delete/reset/restore commands, and new dependency install commands.
- `.codex/hooks/stop-quality-gate.mjs`: runs the detected minimum validation,
  updates `docs/CODEX_CHANGELOG.md`, creates real estate intake notes when
  matching PDF/image files are added, and commits safe candidate changes when
  validation passes.

## Safety behavior

- The hook refuses automatic commits on `main` and `master`.
- The hook never runs `git push`.
- The hook skips files that were already dirty when the turn began, so user work
  is not silently bundled into an automatic commit.
- The hook skips raw binary/PDF assets from auto-commit and records them in the
  changelog instead.
- `.codex/backups/` and `.codex/state/` are local-only and ignored by Git.
- File deletions cause auto-commit to be skipped.
- Installing a new dependency through package-manager add/install commands is
  blocked until you explicitly decide how to handle that install outside the
  automatic hook path.

## Validation command

The project currently has no `npm test` script. The hook therefore uses the
minimum existing check:

```bash
npm run lint
```

For broader verification, use:

```bash
npm run build
```

## Changelog format

`docs/CODEX_CHANGELOG.md` is updated after Codex changes. Each entry records:

- files changed
- objective inferred from changed paths
- impact
- risk
- validation executed
- documentation follow-up
- possible rollback path

## Real estate PDF/image flow

When files that look like real estate availability PDFs or images are added, the
Stop hook creates an intake note in `docs/imobiliaria/pendencias/`.

Use this workflow:

1. Extract visible data from the PDFs/images.
2. Omit fields with no information.
3. Produce copyable Markdown grouped by development, unit, property, or item.
4. Consolidate doubts, illegible values, and missing information at the end under
   `Pendencias`.

If extracted data is available as JSON or key/value text, normalize it with:

```bash
node scripts/organize-real-estate-availability.mjs --input <file> --output docs/imobiliaria/outputs/<name>.md
```

## Rollback

For committed changes, use `git revert <commit>`. For uncommitted edits, restore
from Git or from the timestamped snapshots in `.codex/backups/`.

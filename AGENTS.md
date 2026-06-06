# Project Instructions for Codex

## Safety

- Do not change `main` or `master` directly. Create or stay on a `codex/` branch.
- Do not push automatically.
- Do not delete files or run destructive cleanup commands.
- Ask for explicit confirmation before adding new dependencies.
- Preserve unrelated user changes. If a file was dirty before the task, avoid
  auto-committing it.

## Validation

- Minimum validation for this project is `npm run lint`.
- Use `npm run build` for broader checks when application behavior, routing,
  Supabase integration, or UI flows are affected.
- Report the commands run and their results.

## Documentation

Update README or files under `docs/` when changing endpoints, models,
migrations, scripts, imports, or business rules.

## Codex Hooks

Project-local hooks live in `.codex/` and are documented in
`docs/CODEX_HOOKS.md`. They create local backups, run validation, update the
technical changelog, and create safe local commits when validation passes.

## PDFs and Real Estate Availability

When the user adds PDFs or images about real estate availability:

1. Extract only visible information from the files.
2. Omit fields without information.
3. Organize the result as copyable Markdown grouped by development, property,
   unit, or item.
4. Consolidate doubts, illegible values, and missing confirmations at the end
   under `Pendencias`.
5. If extracted data is available as JSON or key/value text, use
   `scripts/organize-real-estate-availability.mjs` to normalize it.

# Fluxo de Disponibilidade Imobiliaria

Use this folder for real estate availability PDFs, images, extracted text, and
copyable Markdown outputs.

Recommended structure:

- `inbox/`: source PDFs or images provided by the user.
- `pendencias/`: intake notes created by the Codex hook.
- `outputs/`: final copyable Markdown generated after extraction.

Output rules:

- Omit fields without information.
- Keep one section per development, property, unit, or item.
- Preserve visible values exactly when possible.
- Put all doubts, illegible values, and missing confirmations under
  `Pendencias` at the end.

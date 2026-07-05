# Hub VZ

Hub VZ is a private personal hub for finances, goals, decisions, purchases, notes and planning. The financial module is the main module and focuses on monthly payment planning, credit card invoices, reimbursements, third-party expenses, cash flow risk, and practical financial decisions.

This is not intended to be a generic expense tracker. The product exists to help answer operational questions such as:

- What should I pay now?
- What can wait?
- What should I split into installments?
- What will hurt the next credit card invoice?
- How much of my monthly cash flow depends on reimbursements?
- Which bills or debts create the highest risk this month?
- What is my projected balance for this month and the next months?

## Product Purpose

The system is designed for a real personal finance workflow where the user frequently pays expenses with credit cards to generate cashback. Some expenses are personal. Others are paid on behalf of friends or the user's mother and are later reimbursed via Pix.

Those reimbursements are not free income. They must be linked to the original expense, invoice, card transaction, and responsible person. Hub VZ treats reimbursements as first-class financial entities so the user can clearly distinguish:

- Personal income
- Reimbursement inflows
- Third-party money temporarily passing through the user's cash flow
- Real monthly spending
- Credit card invoice pressure
- Pending responsibility from other people

## Planned Stack

The planned first version will use:

- Next.js
- TypeScript
- Tailwind CSS
- PostgreSQL
- Supabase Auth
- Supabase database
- Supabase Row Level Security
- Vercel deployment later

The first version will be web-only. Native mobile apps are not part of the initial scope.

## Current Project Status

The initial application scaffold is in place.

Implemented in the foundation phase:

- Next.js App Router
- TypeScript
- Tailwind CSS
- ESLint
- Prettier configuration
- `src` based project structure
- Responsive dashboard shell
- Sidebar navigation
- Top header
- Reusable base UI components
- Supabase client utilities
- Supabase Auth login and signup UI
- Protected dashboard routes
- Logged user indicator and logout action
- Initial SQL schema with Row Level Security policies
- CRUD for people
- CRUD for categories
- CRUD for accounts payable
- CRUD for income sources
- CRUD for credit cards
- CRUD for credit card invoices
- Invoice transaction management
- Reimbursement tracking linked to people and card transactions
- CRUD for installments
- Payment plans and payment plan items
- Simple deterministic payment decision simulator
- CSV template downloads for the MVP import targets
- CSV/XLSX import preview, validation, skip and confirmation flow for people, categories, accounts payable, income sources, and the system goals/purchases workbook
- Dashboard summaries using real account, income, invoice, transaction, reimbursement, installment and payment plan data
- Dashboard principal com modo simples e visão completa, com preferência salva por usuário
- User-owned personal goals in `/dashboard/goals`
- Decision-focused dashboard sections for pay now, can wait, next invoice pressure and monthly risk
- Monthly cash-flow view with real income separated from reimbursements and third-party money
- Reimbursement visibility by responsible person and linked source
- Total reimbursement debt balance by person, with late rows highlighted by expected date
- Linked cash-entry flow for invoice payments, installment payments and reimbursement receipts
- Voice capture ingestion endpoint for the Vozetiv Capture mobile app
- Voice capture processing pipeline with transcription, AI organization and manual review queue
- Controlled monthly recurring income generation
- CRUD for planned purchases and wishes
- CRUD for roles e lugares
- CRUD for notes
- Functional user settings backed by `profiles`
- Advanced visual preferences for style, density, badges, animation level, card effects, borders and content width
- Dashboard system suggestions calculated from existing data without external AI

Not implemented yet:

- Inline editing of preview rows
- Automatic creation of missing references during import
- Final UX polish and final beta validation pass

## Development Setup

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Build the application:

```bash
npm run build
```

Run linting:

```bash
npm run lint
```

Format files:

```bash
npm run format
```

## Codex Project Hooks

This repository includes project-local Codex hooks in `.codex/`. They create
local backups before edits, run the minimum validation command after code
changes, update a technical changelog, and create a local commit when validation
passes. They do not push automatically and refuse automatic commits on `main` or
`master`.

Review and trust the hooks from Codex with `/hooks`. Details are documented in:

```bash
docs/CODEX_HOOKS.md
```

## Supabase Setup

Create a Supabase project:

1. Go to the Supabase dashboard.
2. Create a new project.
3. Copy the project URL and anon public key from Project Settings > API.
4. Create a local environment file:

```bash
cp .env.example .env.local
```

Required variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=
```

Do not commit `.env.local`.

`NEXT_PUBLIC_SITE_URL` should be the public app URL used by Supabase redirects. Use
`http://localhost:3000` locally and the final Vercel URL in production.

## Database Schema

The initial schema lives at:

```bash
supabase/migrations/202605160001_initial_auth_schema_rls.sql
```

Run it in Supabase SQL Editor or through the Supabase CLI if the project is linked.

The schema creates:

- `profiles`
- `people`
- `categories`
- `accounts_payable`
- `income_sources`
- `credit_cards`
- `credit_card_invoices`
- `credit_card_transactions`
- `reimbursements`
- `installments`
- `payment_plans`
- `payment_plan_items`
- `planned_purchases`
- `goals`
- `notes`
- `import_batches`
- `import_rows`
- `voice_capture_sessions`
- `voice_capture_suggestions`

It also creates:

- Financial distinction enums for real income, reimbursements, third-party money, ownership type, risk, status, and payment decisions.
- A reusable `set_updated_at()` trigger function.
- `updated_at` triggers for all user-owned tables.
- Row Level Security policies for select, insert, update, and delete.
- A `handle_new_user()` trigger to create a profile when a Supabase Auth user is created.
- `create_default_categories_for_current_user()` for optional per-user default categories after login.

The default category helper is user safe because it uses `auth.uid()` and does not create global shared data.

### Voice Capture Ingestion

The Hub exposes the first mobile ingestion endpoint for Vozetiv Capture:

```http
POST /api/voice-captures
```

The request must be authenticated with the current Supabase user session. Mobile clients should send the Supabase access token as:

```http
Authorization: Bearer <access_token>
```

Payload format is `multipart/form-data`:

- `audio`: required audio file
- `localId`: local capture id generated by the mobile app
- `createdAt`: ISO capture date
- `durationSeconds`: audio duration in seconds
- `targetDurationSeconds`: optional target duration
- `source`: `vozetiv-capture-mobile`

Successful response:

```json
{
  "id": "remote-session-id",
  "status": "received",
  "message": "Capture received"
}
```

The endpoint stores the audio in the private Supabase Storage bucket `voice-captures` and creates a row in `voice_capture_sessions` with status `received`. It does not transcribe, call AI, or create Google Tasks yet.

Before testing this endpoint, run:

```bash
supabase/migrations/202607050001_voice_captures.sql
```

The migration creates the storage bucket, session table, indexes, grants, and RLS policies scoped by `user_id`.

### Voice Capture Processing

The first processing pipeline for Vozetiv Capture is available in:

```bash
/dashboard/voice-captures
```

The processing API is:

```http
POST /api/voice-captures/:id/process
GET /api/voice-captures/review
```

Processing flow:

1. Loads a user-owned capture with status `received`.
2. Downloads the private audio file from Supabase Storage.
3. Sends the audio to Gemini for raw transcription.
4. Sends the transcription to Gemini for structured organization.
5. Saves:
   - raw transcription in `voice_capture_sessions.transcription_text`
   - summary in `voice_capture_sessions.ai_summary`
   - structured output in `voice_capture_sessions.ai_extraction_result`
   - pending review items in `voice_capture_suggestions`

The expected structured output is:

```json
{
  "summary": "",
  "suggestedTasks": [],
  "looseIdeas": [],
  "reminders": [],
  "uncertainties": []
}
```

No Google Tasks item is created automatically. All suggestions remain pending for manual review.

Before testing processing, run:

```bash
supabase/migrations/202607050002_voice_capture_processing.sql
```

Server-only environment variables:

```bash
GEMINI_API_KEY=
VOICE_CAPTURE_TRANSCRIPTION_MODEL=gemini-2.5-flash
VOICE_CAPTURE_ORGANIZATION_MODEL=gemini-2.5-flash
VOICE_CAPTURE_MAX_OUTPUT_TOKENS=2500
VOICE_CAPTURE_THINKING_BUDGET=0
```

### Voice Capture End-to-End Test

Run both voice capture migrations before testing with the mobile app:

```bash
supabase/migrations/202607050001_voice_captures.sql
supabase/migrations/202607050002_voice_capture_processing.sql
```

Recommended test flow:

1. Log in to the Hub with the target Supabase user.
2. Log in to Vozetiv Capture with the same Supabase project/user.
3. Record a short audio capture in the mobile app.
4. Send the capture to `POST /api/voice-captures` with `Authorization: Bearer <access_token>`.
5. Store the returned remote `id` in the mobile app.
6. Query `GET /api/voice-captures/:id` with the same bearer token to check remote status.
7. Open `/dashboard/voice-captures` in the Hub and confirm the capture appears.
8. Click process in the Hub to generate transcription and review suggestions.

Status response for mobile polling:

```json
{
  "id": "remote-session-id",
  "status": "received",
  "transcriptionStatus": "not_started",
  "aiExtractionStatus": "not_started",
  "taskReviewStatus": "not_started",
  "processingError": null,
  "suggestionsCount": 0
}
```

Google Tasks is intentionally not used in this flow. Suggestions remain in manual review.

### Linked Payment Entries

The migration below adds traceable links between cash entries and financial actions:

```bash
supabase/migrations/202607020001_linked_payment_entries.sql
```

Run it before testing linked entries. It adds link fields to `income_sources`, generic
`linked_module`/`linked_record_id` references for generated financial records, and allows
`accounts_payable.source_type = invoice_payment`.

Behavior:

- Invoice payments create or update a linked account payable for the invoice payment.
- Installment payments mark the generated installment account as paid, or create a linked generated account if missing.
- Installments outside credit cards can generate monthly accounts in `accounts_payable`; credit-card installments are controlled by invoices and do not create standalone accounts.
- Paying an installment from the Installments screen asks for installment number, payment date, payment method, paid amount and notes, then keeps the generated account synchronized.
- Reimbursements can create or link the original expense as a credit-card transaction or account payable, depending on how the user paid the expense.
- Reimbursement receipts create an `income_sources` entry with `inflow_kind = reimbursement`.
- Generated payment records keep `source_type`, `source_id`, `linked_module`, `linked_record_id` and `is_generated` where supported.
- Audit logs register linked entries, payment registration, financial link creation/update and payment continuation without sufficient entry.
- Only entries with type `real_income` count as free income. Reimbursements, personal contributions, transfers, available cash, loans and other linked entries do not inflate free-income reports.
- If the period has no sufficient registered entry/balance, the UI warns and lets the user register a linked entry, continue anyway, or cancel.

An incremental CRUD migration also lives at:

```bash
supabase/migrations/202605200001_extend_foundation_crud_fields.sql
```

Run this migration after the initial schema. It adds the fields used by the first CRUD screens:

- People: `email`, `phone`
- Categories: `icon`, `is_default`
- Accounts payable: planned payment method, delay flags, delay risk and notes
- Income sources: person, description, confidence, received date and notes

The credit card and reimbursement migration lives at:

```bash
supabase/migrations/202605200002_extend_cards_invoices_reimbursements.sql
```

Run it after the CRUD migration. It adds safe fields and enum values used by the card, invoice, transaction and reimbursement screens:

- Credit cards: `brand`, `notes`
- Credit card invoices: `notes`, additional invoice statuses
- Credit card transactions: shared/family ownership and installment numbers
- Reimbursements: `income_source_id`, `received_date` and indexes for linked lookups

The installments and payment plans migration lives at:

```bash
supabase/migrations/202605200003_extend_installments_payment_plans.sql
```

Run it after the credit card migration. It adds fields and enum values used by installments, payment plans, plan items and the simulator:

- Installments: category, person, start/end dates, current/total installment aliases and notes
- Payment plans: description
- Payment plan items: installment, reimbursement and income links, planned payment date, description and notes
- Decision/status enum values for pay when income arrives, ignore for now, active, completed, cancelled, planned, done and skipped

The import preview migration lives at:

```bash
supabase/migrations/202605210001_extend_import_preview.sql
```

Run it after the payment plans migration. It adds import metadata and status support:

- `import_batches.target_type`
- `import_batches.confirmed_at`
- `import_batches.notes`
- `import_rows.mapped_data`
- `import_rows.errors`
- Additional import statuses for parsed, confirmed, failed and skipped flows
- Import preview metadata for the stabilized MVP import flow

The payment plan item type constraint migration lives at:

```bash
supabase/migrations/202605280001_extend_payment_plan_item_type_check.sql
```

Run it after the import preview migration. It updates the `payment_plan_items.item_type`
check constraint so plan items can safely link to installments, reimbursements and
income sources, matching the payment planner UI.

The goals notes migration lives at:

```bash
supabase/migrations/202605290001_add_goal_notes.sql
```

Run it after the payment plan item type migration. It adds `goals.notes`, used by
the personal goals CRUD.

The income recurrence migration lives at:

```bash
supabase/migrations/202606060001_income_sources_recurrence_fields.sql
```

Run it after the existing income source migrations. It adds controlled monthly recurrence fields to `income_sources`, including parent tracking and generated-until metadata. The app only creates future recurring income rows after an explicit user action, with a limit of 24 occurrences per action.

The advanced visual preferences migration lives at:

```bash
supabase/migrations/202606060002_profile_advanced_visual_preferences.sql
```

Run it after the existing profile visual preference migrations. It adds `animation_level`, `card_effect` and `border_style`, and expands the safe check constraints for the current visual settings UI.

The planned purchases paid fields migration lives at:

```bash
supabase/migrations/202606100001_add_planned_purchase_paid_fields.sql
```

Run it after the existing planned purchases migrations. It adds:

- `planned_purchases.paid_amount`
- `planned_purchases.purchase_date`

The purchases screen uses `purchase_date` as the main indicator that an item was bought. `target_date` remains available as an optional planning date.

## Authentication

The `/login` route supports:

- Email/password sign in.
- Email/password sign up.
- Loading state.
- Error messages.
- Missing Supabase configuration warning.

The `/dashboard` route and all dashboard subroutes are protected in the server layout. If no authenticated user is found, the app redirects to `/login`.

The app shell displays the logged user email and includes a logout button.

## Row Level Security

Every user-owned table includes `user_id`.

RLS policies enforce:

- Users can select only rows where `user_id = auth.uid()`.
- Users can insert only rows where `user_id = auth.uid()`.
- Users can update only rows where `user_id = auth.uid()`.
- Users can delete only rows where `user_id = auth.uid()`.

No public read policies are created.

## Implemented CRUD Modules

The first real CRUD set is implemented under authenticated dashboard routes:

- `/dashboard/people`
- `/dashboard/categories`
- `/dashboard/accounts`
- `/dashboard/income`
- `/dashboard/cards`
- `/dashboard/invoices`
- `/dashboard/invoices/[id]`
- `/dashboard/reimbursements`
- `/dashboard/installments`
- `/dashboard/payment-plans`
- `/dashboard/payment-plans/[id]`
- `/dashboard/imports`
- `/dashboard/goals`
- `/dashboard/cash-flow`
- `/dashboard/purchases`
- `/dashboard/notes`
- `/dashboard/settings`

These pages persist data in Supabase and rely on RLS for user isolation. Inserts send the authenticated user's `user_id`, and reads/updates/deletes are still constrained by database policies.

Current tables used by the app:

- `people`
- `categories`
- `accounts_payable`
- `income_sources`
- `credit_cards`
- `credit_card_invoices`
- `credit_card_transactions`
- `reimbursements`
- `installments`
- `payment_plans`
- `payment_plan_items`
- `planned_purchases`
- `notes`
- `profiles`
- `import_batches`
- `import_rows`

The dashboard now reads:

- `accounts_payable`
- `income_sources`
- `credit_card_invoices`
- `credit_card_transactions`
- `reimbursements`
- `installments`
- `payment_plans`
- `payment_plan_items`
- `planned_purchases`
- `notes`
- `import_batches`

Reimbursements and third-party money are displayed separately from real income. The projected balance can include them for cash-flow visibility, but the UI warns that they are not free income. Invoice transaction ownership distinguishes personal expenses from third-party, shared and family expenses.

## Credit Card Invoice Automation

Credit card invoices can be created automatically when the app needs them.

Rules:

- The app uses each card's `closing_day` and `due_day`.
- A transaction dated after the closing day belongs to the next reference month.
- The invoice due date is placed in the next month when `due_day` is less than or equal to `closing_day`.
- Existing invoices are reused by `user_id`, `credit_card_id` and `reference_month`.
- Archived invoices are not recreated silently; restore the archived invoice first.
- Paid invoices are not recalculated automatically.

Where this is used:

- Creating a card transaction without manually selecting an invoice.
- Generating recurring card transactions.
- Generating future installments on a card.
- Creating a credit card transaction from a reimbursement when no invoice is selected.
- The `/dashboard/invoices` action "Gerar faturas futuras", limited to 24 months per action.

No new database migration is required for this behavior. The existing unique invoice constraint by user, card and reference month prevents duplicate invoices.

## Metas

The `/dashboard/goals` route now uses the `goals` table as a user-owned personal goals module.

The page includes CRUD for the authenticated user's goals using:

- `name`
- `goal_type`
- `target_amount`
- `current_amount`
- `target_date`
- `monthly_contribution`
- `status`
- `notes`

These goals are user-owned data and remain protected by RLS.

## Compras e Desejos

The `/dashboard/purchases` route tracks planned purchases and wishes as decision items before they become real obligations.

The screen includes:

- List and Kanban views.
- Filters by priority, status, category, project, bought/pending state and search.
- Financial summary with estimated total, paid total, savings or overspend, bought items and pending items.
- `purchase_date` as the main bought indicator.
- `target_date` as optional planning metadata.

Internally, the database still uses `risk_level`; the UI labels this field as `Prioridade`.

## Roles e lugares

The `/dashboard/places` route tracks places you want to visit, planned outings, completed experiences and quick personal reviews.

The screen includes:

- List and Kanban views.
- Filters by status, type, city, rating and category.
- Summary cards for `Quero ir`, `Planejados`, `Já fui`, `Melhor nota` and `Custo real do mês`.
- `+ Adicionar` button at the end of each kanban status column.
- Double click on a kanban card to open editing.
- Google Maps link, latitude and longitude fields without any map API dependency.
- Archive in the module and restore through `/dashboard/archived`.

Visited experiences support extra fields when status is `Fui`:

- `visited_date`
- `actual_cost`
- `rating`
- `would_repeat`
- `companion`

Category behavior:

- the UI accepts only categories with `type`/scope `places`, `leisure` or `general`
- if an older record is linked to an out-of-scope category, the current category is shown with a warning and can be replaced safely

Migration necessária antes de testar:

- `supabase/migrations/202606190001_add_places_module.sql`

Como testar manualmente:

1. Abra `/dashboard/places`.
2. Crie `Cafeteria X` com status `Quero ir` ou `Planejado`.
3. Edite o registro e mude para `Fui`.
4. Preencha `Data visitada`, `Custo real`, `Nota` e `Vale repetir`.
5. Abra a visualização `Kanban`, arraste o card entre colunas e confirme que o status muda.
6. Use duplo clique no card para abrir edição.
7. Arquive o lugar.
8. Abra `/dashboard/archived`, filtre `Roles e lugares` e restaure o registro.
9. Valide tema claro e escuro na tela e no modal.

Validação assistida por script:

```bash
npm run validate:places-module
```

O script usa `SUPABASE_IMPORT_ACCESS_TOKEN` em `.env.local`, respeita RLS e valida create, update, archive e restore diretamente na tabela `places`. Se o token estiver expirado, ele falha com mensagem clara pedindo renovação da sessão.

## Decision Dashboard and Cash Flow

The dashboard and cash-flow route use deterministic calculations from the current Supabase data.

Main calculation rules:

- Real income expected: expected `income_sources` where `inflow_kind = real_income`.
- Reimbursements expected: expected `income_sources` where `inflow_kind = reimbursement` plus open `reimbursements`.
- Third-party money expected: expected `income_sources` where `inflow_kind = third_party_money`.
- Pending obligations: pending or overdue accounts, open invoices and active installments.
- Projected balance: real income + linked money - pending obligations.
- Free cash after real obligations: real income - pending obligations.
- Next month pressure: next-month accounts, invoices and installments.

Important: projected balance can include reimbursements and third-party money for visibility, but the UI keeps them visually separated because they are not free income.

## Payment Plans and Simulator

Payment plans are monthly decision scenarios. A plan can include manual items or linked records from:

- Pending accounts payable
- Open or overdue credit card invoices
- Active installments
- Expected income sources
- Pending reimbursements

Each item receives a deterministic decision:

- Pagar agora
- Pagar quando cair renda
- Pagar no cartão
- Parcelar
- Aguardar
- Negociar
- Ignorar por enquanto

The simulator calculates:

- Total planned to pay now
- Total planned when income arrives
- Total planned by credit card
- Total to parcel, wait, negotiate or ignore
- Critical and high risk amounts
- Real income expected
- Reimbursements expected
- Third-party money expected
- Pending obligations
- Estimated remaining cash after planned payments
- Next invoice pressure from pay-by-card decisions plus active installments

Known limitations:

- Calculations are deterministic and rule-based only.
- Plan item links are stored directly where the schema supports them, but no automatic status synchronization is implemented yet.
- Reimbursements and third-party money can help cash flow, but the UI treats them as linked money, not free income.

## Dashboard

The main `/dashboard` page supports two display modes:

- `Resumo simples`: fewer cards and the most actionable blocks first.
- `Visão completa`: keeps the detailed financial cards and decision lists visible.

The selected period and display mode can be saved as the user's default dashboard view.

## Imports

The imports screen is available at `/dashboard/imports`.

Currently supported import targets:

- People
- Categories
- Accounts payable
- Income sources
- Metas e compras using an XLSX file with `Metas_Sistema` and `Compras_Sistema`

Future import targets are visible as "Em breve" and cannot be imported yet:

- Credit cards
- Credit card invoices
- Credit card transactions
- Reimbursements
- Installments
- Planned purchases
- Goals

How to use:

1. Open `/dashboard/imports`.
2. Download a CSV template from "Modelos de planilha".
3. Fill the spreadsheet using the Portuguese headers.
4. Choose the target module.
5. Choose the date format used in the file. The default is Brazilian (`dd/mm/aaaa`).
6. Upload a `.csv` or `.xlsx` file.
7. Click "Prévia".
8. Review original values, mapped values and validation errors.
9. Mark rows as ignored if they should not be imported.
10. Save the preview.
11. Confirm the import.

Validation rules:

- Required fields must be present.
- Amounts must be numeric and greater than or equal to zero.
- Dates must be valid. The import parser accepts `dd/mm/aaaa`, `dd-mm-aaaa`, and `aaaa-mm-dd`.
- The UI lets the user choose `Brasileiro`, `ISO`, or `Automático` before generating the preview.
- Enum-like values are normalized when possible.
- For accounts payable and income sources, categories and people are optional, but when provided they must already exist.
- For the Metas e compras XLSX flow, missing categories are shown as pending warnings. They are not created automatically.
- If saving the preview fails for metas e compras, make sure `supabase/migrations/202606090001_fix_import_preview_persistence.sql` has been executed. It aligns `import_batches` and `import_rows` with the current preview persistence fields.
- Duplicates are blocked by practical matching rules per module.

Metas e compras import:

- `Metas_Sistema` accepts exactly: `Nome`, `Tipo`, `Data alvo`, `Status`, `Observações`.
- `Tipo` is the goal category/type and supports Pessoal, Profissional, Curso, Formação and Projetos.
- Goals imported from `Metas_Sistema` are qualitative by default. Financial fields are not required and are not read from this sheet.
- Goal deadline progress is calculated from the start date and target date. If `Observações` contains `Início: dd/mm/aaaa`, that date is used as the start date.
- `Compras_Sistema` maps planned purchases with description, estimated amount, target date, category, planned payment method, installments, status, risk and notes.
- The preview shows goals read, purchases read, new records, duplicates ignored by default, rows with error, missing categories, summary by goal type, summary by category and summary by status.
- Confirmed rows are tracked with `import_batch_id`, `import_source`, `created_at` and `created_by`.
- Confirmed Metas e compras batches can be undone from import history. The undo only removes records created by that import batch.

Run the migration below before using the updated goals/import flow:

```bash
supabase/migrations/202606050001_goal_quality_and_import_batches.sql
supabase/migrations/202606070001_import_created_by_metadata.sql
```

Local regression check for the mapping rules:

```bash
npm run validate:goals-purchases-import
```

This check does not connect to Supabase. It validates that qualitative goals do
not require financial values, that goal `Tipo` is treated as goal category/type,
that duplicate goals are skipped by default, and that missing purchase categories
remain pending instead of being created.

Local regression check for reimbursement-generated invoice transactions:

```bash
npm run validate:reimbursement-invoice-link
```

This check does not connect to Supabase. It validates that generating a credit
card transaction from a reimbursement saves `invoice_id`, appears through the
invoice transaction query, recalculates the invoice total, blocks duplicates and
blocks invoice/card mismatches.

Local regression check for the reimbursement debt summary:

```bash
npm run validate:reimbursements-debt-summary
```

This check does not connect to Supabase. It validates the per-person debt
summary for open, late, settled and partial reimbursements, plus the summary
view modes and person filter/clear-filter behavior.

Known limitations:

- Preview rows can be skipped but not edited inline yet.
- Missing references are not auto-created.
- Import confirmation uses partial success: valid rows can import while failed rows are marked with errors.
- XLSX/CSV parsing runs in the browser using `xlsx`.
- Credit card, invoice, transaction, reimbursement and installment imports are intentionally disabled until their templates are stabilized.
- Open Finance, OCR, PDF parsing, card scraping, WhatsApp and AI classification are intentionally out of scope.

### Planned purchases spreadsheet import

There is a controlled local script for importing the spreadsheet
`lista_compras_organizada.xlsx` into `planned_purchases`.

Run the migration below before using it:

```bash
supabase/migrations/202606020002_extend_planned_purchases_import_metadata.sql
```

Required local environment variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_IMPORT_USER_ID=
```

Safer authenticated-user alternative:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_IMPORT_ACCESS_TOKEN=
```

With `SUPABASE_IMPORT_ACCESS_TOKEN`, the script validates the authenticated user
and imports through normal RLS instead of service role privileges.

`SUPABASE_SERVICE_ROLE_KEY` is only for this local admin script when the
authenticated-user token is not used. Never add it to Vercel, `.env.example`,
frontend code or any `NEXT_PUBLIC_` variable.
The script loads `.env.local` automatically when the variables are not already
available in the shell.

Offline preview without Supabase, useful for checking the spreadsheet mapping:

```bash
npm run import:purchases -- --file="C:\path\to\lista_compras_organizada.xlsx" --offline-preview
```

Database preview without saving:

```bash
npm run import:purchases -- --file="C:\path\to\lista_compras_organizada.xlsx"
```

Confirm import:

```bash
npm run import:purchases -- --file="C:\path\to\lista_compras_organizada.xlsx" --confirm
```

Optional category creation:

```bash
npm run import:purchases -- --file="C:\path\to\lista_compras_organizada.xlsx" --create-categories --confirm
```

Optional BoardGames tab import:

```bash
npm run import:purchases -- --file="C:\path\to\lista_compras_organizada.xlsx" --include-board-games --confirm
```

### Legacy goals and purchases script

`npm run import:goals-purchases` is intentionally disabled. Use `/dashboard/imports`
with the `Metas e compras` target instead. The current UI flow is safer because it
requires preview, explicit confirmation, `import_batch_id` tracking and does not
create categories automatically.

The script:

- Reads `Base_Consolidada` as the main source.
- Maps item, quantity, current value, rank, purchase status, category, project,
  suggested decision, Notion link and observations.
- Checks duplicates by title and Notion link before inserting.
- Does not delete or update existing purchases.
- Shows preview totals before saving.
- Creates missing categories only when `--create-categories` is provided.

## Deployment

Hub VZ is ready for a private beta deployment on Vercel after the Supabase project and migrations are configured.

Local development:

```bash
npm install
npm run dev
```

Supabase setup:

1. Create a Supabase project.
2. Copy the Project URL and anon public key from Project Settings > API.
3. Run the SQL files in `supabase/migrations` in order.
4. Enable the authentication providers needed for the beta. Email/password is the current supported flow.
5. Configure Auth URLs:
   - Site URL: the deployed Vercel URL, for example `https://financeiro-vz.vercel.app`
   - Redirect URLs: the deployed URL and `/login`, for example `https://financeiro-vz.vercel.app/login`
   - Local Redirect URL for development: `http://localhost:3000/login`

Vercel setup:

1. Import the GitHub repository into Vercel.
2. Keep the default Next.js build command: `npm run build`.
3. Set the environment variables below in Vercel Project Settings.
4. Deploy.
5. After deploy, update Supabase Site URL and Redirect URLs with the final Vercel domain.

Required environment variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=
```

Do not add a Supabase service role key to Vercel or frontend code. The app uses the anon key plus Row Level Security.

Post deploy checklist:

1. Sign up.
2. Log in.
3. Access `/dashboard`.
4. Create a category.
5. Create a person.
6. Create an account payable.
7. Create an income source.
8. Log out.
9. Log in again and reload an authenticated dashboard page.

## Status Beta

The project is in private beta validation status. The main product flows are implemented, but every production change should still pass the manual beta checklist before being trusted with real financial decisions.

Before using with real data, validate:

- Login, logout and persistent session.
- Dashboard calculations and financial separation between real income, reimbursements and third-party money.
- CRUD flows for categories, people, accounts, income, cards, invoices, transactions, reimbursements, installments, payment plans, purchases, goals, notes and settings.
- CRUD flows for roles e lugares, including archive and restore through Arquivados.
- MVP imports only for people, categories, accounts payable and income sources.
- User isolation through Supabase RLS.
- Vercel production environment variables and Supabase Auth redirect URLs.

The full checklist lives at:

- [Beta Test Checklist](docs/BETA_TEST_CHECKLIST.md)

## Como Validar Antes de Usar

1. Run all migrations in Supabase in order.
2. Confirm Vercel has `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SITE_URL`.
3. Confirm Supabase Auth Site URL and Redirect URLs point to the deployed app.
4. Run locally or wait for CI:

```bash
npm run lint
npm run build
```

5. Follow `docs/BETA_TEST_CHECKLIST.md`.
6. Test with two different users to confirm data isolation.
7. Only then add real private financial data.

## Visual Settings Testing

1. Open `/dashboard/settings`.
2. Switch between light and dark theme from the topbar.
3. Change each option in `Aparência do Hub`.
4. Check the preview card, button, badge and table before saving.
5. Save settings and reload `/dashboard`.
6. Confirm cards, tables, buttons, modals and badges remain readable.
7. Test animation presets from `Desligadas` through `Chamativas`; no financial data should change.
8. Test card effects, border styles, density and content width on table-heavy pages such as Accounts, Income and Reimbursements.

The dashboard suggestions section is deterministic. It reads existing accounts, reimbursements, goals, purchases and expected income for the selected period, but it does not write or modify records.

## Limitações Conhecidas do Beta

- Recurrence is intentionally simple and limited to controlled future generation for accounts, reimbursements and income sources.
- Advanced reporting and advanced filters are not part of this beta pass.
- Imports are enabled for people, categories, accounts payable, income sources, and the `Metas e compras` XLSX workbook.
- Import preview rows can be skipped but not edited inline yet.
- Missing import references are not auto-created.
- No Open Finance integration.
- No OCR, PDF parsing or automatic invoice scraping.
- No AI recommendations or AI classification.
- No WhatsApp automation.
- No native mobile app.

## Testing CRUD

1. Configure `.env.local` with Supabase URL and anon key.
2. Run all SQL migrations in Supabase.
3. Start the app:

```bash
npm run dev
```

4. Sign up or sign in at `/login`.
5. Open `/dashboard/people`, `/dashboard/categories`, `/dashboard/accounts`, `/dashboard/income`, `/dashboard/cards`, `/dashboard/invoices`, `/dashboard/reimbursements`, `/dashboard/installments`, `/dashboard/payment-plans`, and `/dashboard/imports`.
6. Create, edit, filter and delete records.
7. Create a card, an invoice, and a linked invoice transaction.
8. Mark a transaction as third-party, shared or family and create an expected reimbursement.
9. Create an installment and confirm the future commitment cards update.
10. Create a payment plan, open it, add items from pending records or manually, choose decisions and review the simulator totals.
11. Mark a plan as active and confirm the dashboard shows the active plan summary.
12. Download an import template, upload a CSV/XLSX file, save the preview and confirm valid rows.

## Next Planned Step

The next planned step is a later final pass:

1. Final beta validation with the user's checklist
2. UX polish and responsive refinements
3. Performance review after real usage

## Development Philosophy

Hub VZ should be built as a decision system before it becomes a reporting system.

The application should prioritize:

- Clear monthly decisions over decorative charts
- Practical payment planning over passive expense history
- Explicit ownership of expenses and reimbursements
- Separation between income, reimbursement, and third-party money
- Conservative financial projections
- Clean, fast, web-first workflows
- Small iterations with usable vertical slices
- Strong data ownership through authentication and Row Level Security

The UI should be clean, practical, and focused on decisions. Screens should help the user understand what requires action, what creates risk, and what can safely wait.

## Documentation

Initial project documentation:

- [Product Specification](docs/PRODUCT_SPEC.md)
- [Feature Plan](docs/FEATURES.md)
- [Database Model](docs/DATABASE_MODEL.md)
- [Roadmap](docs/ROADMAP.md)
- [Architecture Decisions](docs/DECISIONS.md)
- [Deployment Checklist](docs/DEPLOYMENT_CHECKLIST.md)
- [Beta Test Checklist](docs/BETA_TEST_CHECKLIST.md)
## Arquivamento seguro

Os módulos de contas, receitas, faturas, lançamentos de fatura, reembolsos, compras e metas agora usam arquivamento em vez de exclusão definitiva como ação padrão.

- Campos usados: `archived_at`, `archived_by`, `archive_reason`
- Registros arquivados saem das listas principais
- Dashboard e cálculos ignoram arquivados por padrão
- A restauração fica disponível em `/dashboard/archived`

Se a migration `supabase/migrations/202606080002_soft_archive_core_modules.sql` ainda não foi rodada, execute primeiro no Supabase SQL Editor antes de testar a tela de arquivados.

## Histórico de alterações

O Hub VZ agora possui histórico de auditoria para alterações importantes. A estrutura usa a tabela `audit_logs` com RLS por `user_id`.

Eventos registrados nesta etapa:

- criação
- edição
- arquivamento
- restauração
- mudança de fatura de lançamento
- mudança de status
- pagamento de fatura
- reembolso recebido
- renegociação
- importação confirmada
- recálculo financeiro

Interface disponível:

- rota `/dashboard/history` com filtros por módulo, ação, data, texto e registro
- blocos de histórico em fatura, lançamento, reembolso, compra e meta

Migration necessária antes de testar:

- `supabase/migrations/202606170001_add_audit_logs.sql`

## Exportação e backup

O painel de Configurações agora possui a seção `Backup e exportação`.

Formatos disponíveis:

- `Exportar backup XLSX`: gera um arquivo `.xlsx` com aba `Metadata` e uma aba por módulo exportado
- `Exportar backup JSON`: gera um arquivo `.json` com metadata e módulos separados
- `Exportar módulo específico`: permite exportar apenas um módulo em XLSX ou JSON

Módulos disponíveis:

- contas
- receitas
- pessoas
- categorias
- cartões
- faturas
- lançamentos
- reembolsos
- parcelamentos
- compras e desejos
- metas
- revisão semanal
- histórico
- diagnóstico
- importações

Regras e segurança:

- exporta apenas dados do usuário logado
- não exporta tokens, segredos, variáveis de ambiente, refresh token do Google nem access token do Google
- o JSON inclui `metadata`, `data_exportacao`, `usuario`, `versao` e os módulos exportados
- o XLSX inclui a coluna `Exportado em`, datas legíveis em `dd/mm/aaaa` e timestamps em formato brasileiro
- conexões do Google Tasks entram apenas como status e datas de sincronização; o backup nunca inclui credenciais
- o Hub registra `backup_exported` em `audit_logs` quando a exportação é concluída
- o painel lê o último backup a partir do histórico do Supabase e usa o registro local apenas como fallback
- o resumo do último backup mostra arquivo, formato, escopo, módulos exportados e total de registros

Após cada exportação manual, o Hub salva a referência local do arquivo gerado e também registra o evento no histórico para consulta posterior.

Limitações atuais:

- não existe restauração automática nesta etapa
- o diagnóstico exportado é um snapshot calculado no momento da exportação
- o backup manual não substitui backup nativo do Supabase ou point-in-time recovery

## Diagnóstico financeiro

Existe uma rota dedicada em `/dashboard/diagnostics` para revisar inconsistências sem usar SQL manual.

Blocos monitorados:
- lançamentos sem fatura válida
- faturas com total divergente
- reembolsos com vínculo quebrado
- reembolsos renegociados inconsistentes
- faturas vazias
- parcelamentos incompletos
- categorias fora do escopo

Ações seguras disponíveis:
- recalcular fatura
- abrir item relacionado
- criar/vincular fatura correta com confirmação
- ignorar alerta

Migration necessária antes de testar:
- `supabase/migrations/202606170002_add_diagnostic_alert_ignores.sql`

Essa migration cria a tabela `diagnostic_alert_ignores`, usada para ocultar alertas revisados sem apagar dados financeiros.

## Revisão semanal com Google Tasks

A rota `/dashboard/weekly-review` adiciona uma camada de leitura e histórico sobre o Google Tasks.
O Hub VZ não edita, move ou conclui tarefas no Google; ele apenas lê, sincroniza, categoriza internamente e gera eventos/relatórios.

Configuração OAuth:
- Crie um OAuth Client no Google Cloud Console.
- Ative a Google Tasks API.
- Configure o redirect URI: `https://SEU_DOMINIO/api/routine/google-tasks/callback`
- Em desenvolvimento local: `http://localhost:3000/api/routine/google-tasks/callback`
- Configure as variáveis server-side:
  - `GOOGLE_TASKS_CLIENT_ID`
  - `GOOGLE_TASKS_CLIENT_SECRET`
  - `GOOGLE_TASKS_TOKEN_ENCRYPTION_KEY`
  - `GEMINI_API_KEY` para gerar a análise textual da semana
  - `GEMINI_WEEKLY_REVIEW_MODEL` para escolher o modelo da análise semanal, padrão `gemini-2.5-flash`
  - `GEMINI_WEEKLY_REVIEW_MAX_OUTPUT_TOKENS` para controlar o limite de saída da análise, padrão `3000`
  - `GEMINI_WEEKLY_REVIEW_THINKING_BUDGET` para controlar thinking no Gemini 2.5 Flash, padrão `0`
  - `CRON_SECRET` para proteger a sincronização automática
  - `SUPABASE_SERVICE_ROLE_KEY` somente no servidor, usado pelo cron para processar usuários conectados

Escopo usado:
- `https://www.googleapis.com/auth/tasks.readonly`

Migrations necessárias:
- `supabase/migrations/202606180001_routine_weekly_review_google_tasks.sql`
- `supabase/migrations/202606180002_routine_ai_summaries.sql`
- `supabase/migrations/202606180003_routine_auto_sync_runs.sql`

Como testar sincronização manual:
1. Rode a migration no Supabase.
2. Configure as variáveis OAuth no ambiente local/Vercel.
3. Abra `/dashboard/weekly-review`.
4. Clique em `Conectar Google Tasks`.
5. Autorize a conta Google.
6. Clique em `Sincronizar agora`.
7. Confira listas, tarefas abertas/concluídas, eventos da semana, contagens por lista/categoria e visão mensal.
8. Selecione a semana desejada.
9. Clique em `Gerar análise da semana`.
10. Confira status, data da última análise e texto salvo.

A análise com Gemini:

- roda somente após clique explícito do usuário
- usa chamada server-side, sem expor `GEMINI_API_KEY` no frontend
- envia apenas um JSON resumido com contagens, títulos, datas, listas, categorias e eventos relevantes
- limita o payload padrão para até 12 tarefas concluídas, 12 tarefas abertas e 10 eventos relevantes
- em caso de `MAX_TOKENS`, tenta novamente com 8 concluídas, 8 abertas e 5 eventos
- ignora eventos `CREATED` em massa no payload da IA
- envia JSON compacto com `JSON.stringify(inputSummary)` para reduzir tokens
- envia `generationConfig.thinkingConfig.thinkingBudget`, padrão `0`
- orienta o Gemini a responder em Markdown/texto estruturado, nunca em JSON ou bloco de código
- se uma resposta antiga vier como JSON ou ```json, o Hub extrai `revisao_semanal` e renderiza como relatório visual
- exibe a análise em seções visuais: Resumo da semana, Avanços, Focos da semana, Pontos negligenciados, Pendências e Próxima semana
- não envia `raw_json`, tokens, IDs internos sensíveis ou dados desnecessários
- não cria, edita, move ou conclui tarefas no Google Tasks
- salva o resultado em `routine_ai_summaries` por semana
- salva metadados de diagnóstico em `input_summary_json.metadata.gemini`: `finishReason`, `usageMetadata` resumido, contagem de tokens, `safetyRatings`, `promptFeedback`, modelo e limite de saída
- se `finishReason=MAX_TOKENS`, mostra erro indicando que o Hub reduziu os dados e tentou novamente
- se houver bloqueio de segurança, mostra erro para revisar os dados enviados
- considera a análise válida com mais de 700 caracteres e pelo menos 4 seções esperadas

Sincronização automática:

- endpoint: `/api/routine/sync/google-tasks`
- protegido por `CRON_SECRET`
- configurado em `vercel.json` para rodar a cada 1 hora
- usa o mesmo motor da sincronização manual
- registra execuções em `routine_sync_runs`
- atualiza `last_sync_attempt_at`, `last_successful_sync_at` e `last_sync_error`
- não chama Gemini
- não edita, move, cria ou conclui tarefas no Google Tasks
- deduplica eventos por assinatura de tarefa, tipo, valor antigo e valor novo

Teste local do cron:

```bash
curl -X POST "http://localhost:3000/api/routine/sync/google-tasks?secret=SEU_CRON_SECRET"
```

Teste em produção:

```bash
curl -X POST "https://SEU_DOMINIO/api/routine/sync/google-tasks" \
  -H "Authorization: Bearer SEU_CRON_SECRET"
```

Variáveis necessárias na Vercel para o cron:

```bash
CRON_SECRET=
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_TASKS_CLIENT_ID=
GOOGLE_TASKS_CLIENT_SECRET=
GOOGLE_TASKS_TOKEN_ENCRYPTION_KEY=
```

`SUPABASE_SERVICE_ROLE_KEY` é usado apenas por rota server-side protegida. Nunca use essa chave em código client-side nem em variável `NEXT_PUBLIC_`.

Eventos detectados no MVP:
- `CREATED`
- `MOVED_LIST`
- `PRIORITIZED`
- `COMPLETED`
- `REOPENED`
- `TITLE_CHANGED`
- `NOTES_CHANGED`
- `DUE_DATE_CHANGED`

Regra de baseline da primeira sincronização:
- a primeira sincronização cria o estado inicial das tarefas no Hub
- eventos de movimento e prioridade passam a ser gerados apenas quando já existe histórico local para comparação
- `Geral/Hoje` é tratado como fila de prioridade, não como categoria principal
- a tela de Revisão semanal esconde eventos técnicos e IDs do Google em "Dados técnicos"
- cards, mês, relatórios salvos e payload da IA usam apenas eventos reais; eventos `CREATED` e `PRIORITIZED` herdados da primeira sincronização ficam só como contexto técnico
- respostas curtas ou truncadas do Gemini são salvas como erro e precisam ser geradas novamente

Validação local do baseline inflado:

```bash
npm run validate:weekly-review-baseline
```

Esse script simula uma semana com primeira sincronização inflada e valida que:
- `Geral/Hoje` herdado não entra como prioridade real
- `CREATED` herdado não entra como evento real
- um mesmo movimento real para `Geral/Hoje` não é contado duas vezes
- o payload da IA usa apenas dados confiáveis

Pendências para sync automático:
- definir janela de sincronização automática e retenção de snapshots
- avaliar versionamento de múltiplas análises por semana, se houver necessidade histórica

## Preferências da IA

O Hub agora salva contexto de IA por usuário em `profiles.ai_preferences`.

Essa base guarda:
- áreas da vida
- objetivos e prioridades
- rotina e notas de contexto
- categorias importantes
- áreas prioritárias
- áreas que não devem virar urgência
- instruções do que a IA deve considerar e evitar
- flags para usar ou não histórico financeiro, de tarefas e de roles/lugares

Na tela de `Configurações`, a seção `Preferências da IA` permite ajustar esse contexto. A Revisão semanal já injeta essas preferências e um resumo curto das últimas semanas no payload enviado ao Gemini.

Aplicações atuais dessa base:
- `Revisão semanal`: análise contextual da semana com histórico recente
- `Dashboard`: botão `Gerar briefing`
- `Diagnóstico financeiro`: ação `Explicar com IA` por alerta
- `Metas`: botão `Analisar metas`
- `Compras e desejos`: botão `Analisar compras`

Toda resposta nova da IA nessas telas permite:
- aceitar
- ignorar
- copiar
- marcar como útil
- marcar como não útil

Migration necessária antes de testar no Supabase:
- `supabase/migrations/202606200001_profile_ai_preferences.sql`

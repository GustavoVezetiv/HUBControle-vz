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
- User-owned personal goals in `/dashboard/goals`
- Decision-focused dashboard sections for pay now, can wait, next invoice pressure and monthly risk
- Monthly cash-flow view with real income separated from reimbursements and third-party money
- Reimbursement visibility by responsible person and linked source
- Total reimbursement debt balance by person, with late rows highlighted by expected date
- Controlled monthly recurring income generation
- CRUD for planned purchases and wishes
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

It also creates:

- Financial distinction enums for real income, reimbursements, third-party money, ownership type, risk, status, and payment decisions.
- A reusable `set_updated_at()` trigger function.
- `updated_at` triggers for all user-owned tables.
- Row Level Security policies for select, insert, update, and delete.
- A `handle_new_user()` trigger to create a profile when a Supabase Auth user is created.
- `create_default_categories_for_current_user()` for optional per-user default categories after login.

The default category helper is user safe because it uses `auth.uid()` and does not create global shared data.

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
5. Upload a `.csv` or `.xlsx` file.
6. Click "Prévia".
7. Review original values, mapped values and validation errors.
8. Mark rows as ignored if they should not be imported.
9. Save the preview.
10. Confirm the import.

Validation rules:

- Required fields must be present.
- Amounts must be numeric and greater than or equal to zero.
- Dates must be valid.
- Enum-like values are normalized when possible.
- For accounts payable and income sources, categories and people are optional, but when provided they must already exist.
- For the Metas e compras XLSX flow, missing categories are shown as pending warnings. They are not created automatically.
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

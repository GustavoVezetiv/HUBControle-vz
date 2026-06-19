# Database Model

## Principles

The database should enforce user ownership and make financial responsibility explicit.

Core principles:

- Every user-owned business table should include `user_id`.
- Row Level Security should ensure users only access their own records.
- Reimbursements must be first-class entities, not generic income rows.
- Income, reimbursement, and third-party money must be distinguishable.
- Imported data should remain staged until reviewed and accepted.
- Financial records should preserve enough context to support monthly decisions.

Recommended common fields for most tables:

- `id`: primary key, preferably UUID.
- `user_id`: owner, linked to `auth.users`.
- `created_at`: creation timestamp.
- `updated_at`: last update timestamp.
- `deleted_at`: nullable soft-delete timestamp where useful.

## Entity Overview

### users/profile

Supabase Auth provides `auth.users`. The application should create a related `profiles` table.

Purpose:

- Store application-specific user information.
- Keep preferences separate from authentication data.

Important fields:

- `id`: UUID, same value as `auth.users.id`.
- `display_name`: user-facing name.
- `currency`: default currency, initially `BRL`.
- `timezone`: default timezone.
- `month_start_day`: optional preference for financial month logic.

Relationships:

- One profile belongs to one authenticated user.
- All user-owned records reference this user through `user_id`.

### people

Purpose:

- Represent people related to reimbursable or third-party expenses.
- Examples: friends, mother, family members.

Important fields:

- `id`
- `user_id`
- `name`
- `relationship_type`: friend, mother, family, work, other.
- `pix_key`: optional.
- `notes`
- `is_active`

Relationships:

- A person can be responsible for many reimbursements.
- A person can be linked to many credit card transactions.

### categories

Purpose:

- Classify expenses, income, payables, planned purchases, and reimbursements.

Important fields:

- `id`
- `user_id`
- `name`
- `type`: expense, income, reimbursement, debt, transfer, planned_purchase, other.
- `parent_category_id`: optional self-reference.
- `color`
- `is_active`

Relationships:

- Categories can be used by transactions, payables, income sources, and planned purchases.

### accounts_payable

Purpose:

- Track bills, debts, and obligations that need payment planning.

Important fields:

- `id`
- `user_id`
- `category_id`
- `person_id`: optional, if related to another person.
- `title`
- `description`
- `amount`
- `due_date`
- `status`: pending, scheduled, paid, overdue, canceled.
- `priority`: low, normal, high, critical.
- `risk_level`: low, medium, high.
- `is_recurring`
- `recurrence_rule`: optional future recurrence definition.
- `paid_at`

Relationships:

- Can be linked to payment plan items.
- Can be linked to reimbursements if the payable was created for someone else.

### income_sources

Purpose:

- Track real income sources and expected inflows.
- Reimbursements should not be stored only here. They may appear in projections but must have their own reimbursement records.

Important fields:

- `id`
- `user_id`
- `category_id`
- `name`
- `source_type`: salary, freelance, benefit, other_income.
- `amount`
- `expected_date`
- `is_recurring`
- `recurrence_rule`
- `status`: expected, received, canceled.
- `received_at`

Relationships:

- Used by cash flow projections.

### credit_cards

Purpose:

- Store credit card configuration and limits.

Important fields:

- `id`
- `user_id`
- `name`
- `issuer`
- `last_four_digits`
- `limit_amount`
- `closing_day`
- `due_day`
- `cashback_rate`
- `is_active`

Relationships:

- A credit card has many invoices.
- A credit card has many transactions through invoices.

### credit_card_invoices

Purpose:

- Represent monthly card invoices.

Important fields:

- `id`
- `user_id`
- `credit_card_id`
- `reference_month`
- `closing_date`
- `due_date`
- `status`: open, closed, paid, overdue, canceled.
- `total_amount`
- `personal_amount`
- `reimbursable_amount`
- `paid_amount`
- `paid_at`

Relationships:

- Belongs to a credit card.
- Has many credit card transactions.
- Can appear in payment plans.

### credit_card_transactions

Purpose:

- Store purchases and charges made on credit cards.
- Each transaction should be classified by ownership and invoice impact.

Important fields:

- `id`
- `user_id`
- `credit_card_id`
- `invoice_id`
- `category_id`
- `person_id`: optional responsible person if third-party or reimbursable.
- `description`
- `merchant`
- `amount`
- `transaction_date`
- `posting_date`
- `ownership_type`: personal, reimbursable, third_party.
- `is_reimbursable`
- `reimbursement_status`: not_applicable, pending, partial, received.
- `installment_group_id`: optional link to installments.
- `notes`

Relationships:

- Belongs to a card invoice.
- Can generate or link to reimbursements.
- Can be part of an installment group.

### reimbursements

Purpose:

- Track money owed back to the user for expenses paid on behalf of someone else.
- This is a central entity of the product.

Important fields:

- `id`
- `user_id`
- `person_id`
- `category_id`
- `source_type`: credit_card_transaction, account_payable, manual, other.
- `source_id`: nullable polymorphic reference target, handled carefully at application level.
- `credit_card_transaction_id`: optional direct reference when applicable.
- `account_payable_id`: optional direct reference when applicable.
- `credit_card_invoice_id`: optional for invoice context.
- `description`
- `expected_amount`
- `received_amount`
- `expected_date`
- `received_at`
- `status`: expected, partial, received, overdue, canceled.
- `pix_reference`: optional.
- `notes`

Relationships:

- Belongs to a person.
- Can link to original card transaction, payable item, and invoice.
- Used in cash flow projections separately from income.

### installments

Purpose:

- Represent installment groups and future monthly impacts.

Implementation option:

- Use one table for installment entries with a shared `installment_group_id`, or split later into `installment_groups` and `installments`.
- For the MVP, this table can store each installment row and group related rows by `installment_group_id`.

Important fields:

- `id`
- `user_id`
- `installment_group_id`
- `credit_card_transaction_id`
- `credit_card_id`
- `invoice_id`
- `description`
- `total_amount`
- `installment_amount`
- `installment_number`
- `installment_count`
- `due_month`
- `status`: pending, posted, paid, canceled.

Relationships:

- Can be linked to credit card transactions and invoices.
- Used in future invoice projections.

### payment_plans

Purpose:

- Represent a monthly decision plan.

Important fields:

- `id`
- `user_id`
- `reference_month`
- `name`
- `starting_balance`
- `projected_income`
- `projected_reimbursements`
- `projected_expenses`
- `projected_ending_balance`
- `status`: draft, active, closed, archived.
- `notes`

Relationships:

- Has many payment plan items.

### payment_plan_items

Purpose:

- Store actionable items inside a payment plan.

Important fields:

- `id`
- `user_id`
- `payment_plan_id`
- `item_type`: account_payable, credit_card_invoice, planned_purchase, goal, manual.
- `source_id`: optional application-level reference.
- `account_payable_id`: optional direct reference.
- `credit_card_invoice_id`: optional direct reference.
- `planned_purchase_id`: optional direct reference.
- `goal_id`: optional direct reference.
- `title`
- `amount`
- `due_date`
- `decision`: pay_now, wait, parcel, monitor, skip.
- `priority`
- `risk_level`
- `status`: planned, scheduled, paid, deferred, canceled.

Relationships:

- Belongs to a payment plan.
- Can reference payables, invoices, purchases, and goals.

### planned_purchases

Purpose:

- Track purchases being considered before they are made.

Important fields:

- `id`
- `user_id`
- `category_id`
- `title`
- `description`
- `estimated_amount`
- `target_date`
- `payment_method`: cash, credit_card, installment, unknown.
- `credit_card_id`: optional.
- `installment_count`: optional.
- `decision_status`: considering, approved, delayed, canceled, purchased.
- `risk_level`
- `notes`

Relationships:

- Can be added to payment plan items.
- Can later become a payable or credit card transaction.

### goals

Purpose:

- Track simple personal financial goals.

Important fields:

- `id`
- `user_id`
- `name`
- `goal_type`: emergency_reserve, debt_reduction, planned_purchase, savings, other.
- `target_amount`
- `current_amount`
- `target_date`
- `monthly_contribution`
- `status`: active, paused, completed, canceled.
- `notes`

Relationships:

- Can appear in payment plans and projections.

### places

Purpose:

- Track places to visit, planned outings, visited experiences and personal ratings without mixing this data into the core financial modules.

Important fields:

- `id`
- `user_id`
- `category_id`
- `name`
- `description`
- `place_type`: restaurant, bar, cafe, outing, trip, event, cinema, park, shopping, other.
- `status`: want_to_go, planned, visited, cancelled.
- `city`
- `district`
- `address`
- `google_maps_url`
- `latitude`
- `longitude`
- `planned_date`
- `visited_date`
- `estimated_cost`
- `actual_cost`
- `rating`: 1 to 5.
- `would_repeat`
- `companion`
- `notes`
- `archived_at`

Relationships:

- Belongs to one user and can optionally link to a category.
- Uses the shared archive flow so visited or cancelled places can be restored later from archived records.
- Category filtering should accept only `places`, `leisure` or `general` scopes in the UI.

### notes

Purpose:

- Store contextual notes for financial decisions and records.

Important fields:

- `id`
- `user_id`
- `entity_type`: person, invoice, transaction, reimbursement, payable, payment_plan, planned_purchase, goal, general.
- `entity_id`: optional application-level reference.
- `title`
- `body`
- `pinned`

Relationships:

- Can be attached to many kinds of records through `entity_type` and `entity_id`.

### import_batches

Purpose:

- Represent an uploaded import file or import attempt.
- Imported data must be previewed before saving.

Important fields:

- `id`
- `user_id`
- `module`: credit_card_transactions, accounts_payable, reimbursements, income_sources, people, categories, planned_purchases.
- `file_name`
- `file_type`: csv, xlsx.
- `status`: uploaded, parsed, validated, imported, failed, canceled.
- `total_rows`
- `valid_rows`
- `invalid_rows`
- `mapping_config`: JSONB with user-selected column mapping.
- `imported_at`

Relationships:

- Has many import rows.

### import_rows

Purpose:

- Store raw and parsed rows from an import batch before they become official records.

Important fields:

- `id`
- `user_id`
- `import_batch_id`
- `row_number`
- `raw_data`: JSONB.
- `parsed_data`: JSONB.
- `validation_errors`: JSONB.
- `status`: pending, valid, invalid, skipped, imported.
- `target_entity_type`
- `target_entity_id`: filled after import.

Relationships:

- Belongs to an import batch.
- May later reference the created application record.

## Relationship Summary

- `profiles.id` maps to `auth.users.id`.
- Most tables include `user_id` for ownership and RLS policies.
- `people` connects responsible third parties to reimbursements and transactions.
- `credit_cards` have many `credit_card_invoices`.
- `credit_card_invoices` have many `credit_card_transactions`.
- `credit_card_transactions` can create or link to `reimbursements`.
- `reimbursements` link expected Pix inflows to original expenses and responsible people.
- `payment_plans` group monthly decision items.
- `payment_plan_items` reference payables, invoices, planned purchases, goals, or manual decisions.
- `import_batches` and `import_rows` stage imported CSV/XLSX data before official persistence.

## Row Level Security Direction

Each user-owned table should have policies similar to:

- Users can select rows where `user_id = auth.uid()`.
- Users can insert rows where `user_id = auth.uid()`.
- Users can update rows where `user_id = auth.uid()`.
- Users can delete or soft-delete rows where `user_id = auth.uid()`.

For `profiles`, users should only access their own profile row where `id = auth.uid()`.

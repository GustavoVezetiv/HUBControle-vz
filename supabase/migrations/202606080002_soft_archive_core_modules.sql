alter table public.reimbursements
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null,
  add column if not exists archive_reason text;

alter table public.accounts_payable
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null,
  add column if not exists archive_reason text;

alter table public.income_sources
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null,
  add column if not exists archive_reason text;

alter table public.credit_card_invoices
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null,
  add column if not exists archive_reason text;

alter table public.credit_card_transactions
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null,
  add column if not exists archive_reason text;

alter table public.planned_purchases
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null,
  add column if not exists archive_reason text;

alter table public.goals
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null,
  add column if not exists archive_reason text;

create index if not exists reimbursements_archived_at_idx on public.reimbursements(user_id, archived_at);
create index if not exists accounts_payable_archived_at_idx on public.accounts_payable(user_id, archived_at);
create index if not exists income_sources_archived_at_idx on public.income_sources(user_id, archived_at);
create index if not exists credit_card_invoices_archived_at_idx on public.credit_card_invoices(user_id, archived_at);
create index if not exists credit_card_transactions_archived_at_idx on public.credit_card_transactions(user_id, archived_at);
create index if not exists planned_purchases_archived_at_idx on public.planned_purchases(user_id, archived_at);
create index if not exists goals_archived_at_idx on public.goals(user_id, archived_at);

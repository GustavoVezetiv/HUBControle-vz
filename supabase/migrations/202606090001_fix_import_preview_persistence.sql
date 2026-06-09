alter table public.import_batches
  add column if not exists target_type text,
  add column if not exists confirmed_at timestamptz,
  add column if not exists notes text;

alter table public.import_rows
  add column if not exists mapped_data jsonb,
  add column if not exists errors jsonb;

alter table public.import_batches
  drop constraint if exists import_batches_module_check;

alter table public.import_batches
  add constraint import_batches_module_check
  check (
    module in (
      'credit_card_transactions',
      'accounts_payable',
      'reimbursements',
      'income_sources',
      'people',
      'categories',
      'planned_purchases',
      'goals',
      'system_goals_purchases'
    )
  );

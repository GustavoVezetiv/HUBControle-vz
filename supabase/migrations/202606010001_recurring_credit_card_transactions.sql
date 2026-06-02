alter table public.credit_card_transactions
  add column if not exists is_recurring boolean not null default false,
  add column if not exists recurrence_frequency text,
  add column if not exists recurrence_start_date date,
  add column if not exists recurrence_end_date date,
  add column if not exists recurrence_parent_id uuid references public.credit_card_transactions(id) on delete set null,
  add column if not exists recurrence_generated_until date;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'credit_card_transactions_recurrence_frequency_check'
  ) then
    alter table public.credit_card_transactions
      add constraint credit_card_transactions_recurrence_frequency_check
      check (recurrence_frequency is null or recurrence_frequency in ('monthly'));
  end if;
end $$;

create index if not exists credit_card_transactions_recurrence_parent_idx
  on public.credit_card_transactions(user_id, recurrence_parent_id, transaction_date);

create unique index if not exists credit_card_transactions_unique_generated_recurrence_date_idx
  on public.credit_card_transactions(user_id, recurrence_parent_id, transaction_date)
  where recurrence_parent_id is not null;

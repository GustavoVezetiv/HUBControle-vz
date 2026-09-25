-- Shared reimbursement entries remain individual debts. The group only keeps
-- the common purchase context so payments and history stay person-specific.
-- Existing flows already use several source labels beyond the original enum,
-- so make the persisted label extensible while retaining every current value.
alter table public.reimbursements
  alter column source_type drop default,
  alter column source_type type text using source_type::text,
  alter column source_type set default 'manual';

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  credit_card_id uuid not null references public.credit_cards(id) on delete restrict,
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  description text,
  amount numeric(14, 2) not null check (amount > 0),
  billing_day integer not null check (billing_day between 1 and 31),
  start_date date not null,
  end_date date,
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  notes text,
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  archive_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint subscriptions_end_date_after_start check (end_date is null or end_date >= start_date)
);

create table if not exists public.reimbursement_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  credit_card_transaction_id uuid references public.credit_card_transactions(id) on delete set null,
  credit_card_invoice_id uuid references public.credit_card_invoices(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  description text not null,
  expected_date date,
  total_amount numeric(14, 2) not null default 0 check (total_amount >= 0),
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.reimbursements
  add column if not exists reimbursement_group_id uuid references public.reimbursement_groups(id) on delete set null;

create table if not exists public.subscription_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete restrict,
  share_amount numeric(14, 2) not null check (share_amount > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (subscription_id, person_id)
);

create table if not exists public.subscription_occurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  reference_month date not null,
  transaction_date date not null,
  credit_card_transaction_id uuid references public.credit_card_transactions(id) on delete set null,
  reimbursement_group_id uuid references public.reimbursement_groups(id) on delete set null,
  status text not null default 'generating' check (status in ('generating', 'generated', 'failed')),
  error_message text,
  generated_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (subscription_id, reference_month)
);

create index if not exists subscriptions_user_status_idx on public.subscriptions(user_id, status);
create index if not exists reimbursement_groups_user_created_idx on public.reimbursement_groups(user_id, created_at desc);
create index if not exists reimbursements_group_idx on public.reimbursements(user_id, reimbursement_group_id);
create index if not exists subscription_members_user_subscription_idx on public.subscription_members(user_id, subscription_id);
create index if not exists subscription_occurrences_user_subscription_idx on public.subscription_occurrences(user_id, subscription_id, reference_month desc);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['subscriptions', 'reimbursement_groups', 'subscription_members', 'subscription_occurrences']
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon', table_name);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_select_own', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_insert_own', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_update_own', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_delete_own', table_name);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', table_name || '_select_own', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', table_name || '_insert_own', table_name);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', table_name || '_update_own', table_name);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', table_name || '_delete_own', table_name);
  end loop;
end $$;

drop trigger if exists set_subscriptions_updated_at on public.subscriptions;
create trigger set_subscriptions_updated_at before update on public.subscriptions for each row execute function public.set_updated_at();
drop trigger if exists set_reimbursement_groups_updated_at on public.reimbursement_groups;
create trigger set_reimbursement_groups_updated_at before update on public.reimbursement_groups for each row execute function public.set_updated_at();
drop trigger if exists set_subscription_members_updated_at on public.subscription_members;
create trigger set_subscription_members_updated_at before update on public.subscription_members for each row execute function public.set_updated_at();
drop trigger if exists set_subscription_occurrences_updated_at on public.subscription_occurrences;
create trigger set_subscription_occurrences_updated_at before update on public.subscription_occurrences for each row execute function public.set_updated_at();

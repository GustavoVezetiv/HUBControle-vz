create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  module text not null,
  record_id uuid null,
  action text not null,
  field_name text null,
  old_value jsonb null,
  new_value jsonb null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists audit_logs_user_created_at_idx
  on public.audit_logs (user_id, created_at desc);

create index if not exists audit_logs_user_module_idx
  on public.audit_logs (user_id, module);

create index if not exists audit_logs_user_record_idx
  on public.audit_logs (user_id, record_id);

create index if not exists audit_logs_user_action_idx
  on public.audit_logs (user_id, action);

alter table public.audit_logs enable row level security;

drop policy if exists "Users can read own audit logs" on public.audit_logs;
create policy "Users can read own audit logs"
  on public.audit_logs
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own audit logs" on public.audit_logs;
create policy "Users can insert own audit logs"
  on public.audit_logs
  for insert
  with check (auth.uid() = user_id);

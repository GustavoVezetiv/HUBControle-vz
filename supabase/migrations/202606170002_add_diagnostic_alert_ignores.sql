create table if not exists public.diagnostic_alert_ignores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  alert_key text not null,
  alert_type text not null,
  subject_type text,
  subject_id uuid,
  reason text,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists diagnostic_alert_ignores_user_alert_key_idx
  on public.diagnostic_alert_ignores (user_id, alert_key);

create index if not exists diagnostic_alert_ignores_user_alert_type_idx
  on public.diagnostic_alert_ignores (user_id, alert_type);

alter table public.diagnostic_alert_ignores enable row level security;

drop policy if exists "Users can read own diagnostic ignores" on public.diagnostic_alert_ignores;
create policy "Users can read own diagnostic ignores"
  on public.diagnostic_alert_ignores
  for select
  using (user_id = auth.uid());

drop policy if exists "Users can insert own diagnostic ignores" on public.diagnostic_alert_ignores;
create policy "Users can insert own diagnostic ignores"
  on public.diagnostic_alert_ignores
  for insert
  with check (user_id = auth.uid());

drop policy if exists "Users can delete own diagnostic ignores" on public.diagnostic_alert_ignores;
create policy "Users can delete own diagnostic ignores"
  on public.diagnostic_alert_ignores
  for delete
  using (user_id = auth.uid());

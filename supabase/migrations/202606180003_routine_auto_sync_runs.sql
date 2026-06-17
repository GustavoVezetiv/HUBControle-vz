alter table public.routine_google_connections
  add column if not exists last_sync_attempt_at timestamptz,
  add column if not exists last_successful_sync_at timestamptz,
  add column if not exists auto_sync_enabled boolean not null default true;

create table if not exists public.routine_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'google_tasks',
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  status text not null default 'running',
  tasks_seen integer not null default 0,
  tasks_created integer not null default 0,
  tasks_updated integer not null default 0,
  events_created integer not null default 0,
  error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint routine_sync_runs_status_check check (status in ('running', 'success', 'partial_error', 'failed', 'skipped'))
);

alter table public.routine_task_events
  add column if not exists sync_run_id uuid references public.routine_sync_runs(id) on delete set null,
  add column if not exists event_signature text;

create index if not exists routine_sync_runs_user_started_idx
  on public.routine_sync_runs (user_id, started_at desc);

create index if not exists routine_sync_runs_provider_status_idx
  on public.routine_sync_runs (provider, status, started_at desc);

drop index if exists public.routine_task_events_user_signature_idx;
create unique index routine_task_events_user_signature_idx
  on public.routine_task_events (user_id, event_signature);

alter table public.routine_sync_runs enable row level security;

drop policy if exists "routine_sync_runs_select_own" on public.routine_sync_runs;
create policy "routine_sync_runs_select_own"
  on public.routine_sync_runs
  for select
  using (user_id = auth.uid());

drop policy if exists "routine_sync_runs_insert_own" on public.routine_sync_runs;
create policy "routine_sync_runs_insert_own"
  on public.routine_sync_runs
  for insert
  with check (user_id = auth.uid());

drop policy if exists "routine_sync_runs_update_own" on public.routine_sync_runs;
create policy "routine_sync_runs_update_own"
  on public.routine_sync_runs
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "routine_sync_runs_delete_own" on public.routine_sync_runs;
create policy "routine_sync_runs_delete_own"
  on public.routine_sync_runs
  for delete
  using (user_id = auth.uid());

create table if not exists public.routine_google_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'google_tasks',
  status text not null default 'disconnected',
  scope text not null default '',
  encrypted_access_token text,
  encrypted_refresh_token text,
  token_expires_at timestamptz,
  connected_at timestamptz,
  last_sync_at timestamptz,
  last_sync_error text,
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, provider)
);

create table if not exists public.routine_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text,
  is_default boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, name)
);

create table if not exists public.routine_task_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  google_task_list_id text not null,
  title text not null,
  is_priority_queue boolean not null default false,
  updated_at_google timestamptz,
  last_seen_at timestamptz not null default timezone('utc', now()),
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, google_task_list_id)
);

create table if not exists public.routine_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  google_task_id text not null,
  google_task_list_id text not null,
  routine_task_list_id uuid references public.routine_task_lists(id) on delete set null,
  title text not null,
  notes text,
  status text not null,
  due_date date,
  completed_at timestamptz,
  updated_at_google timestamptz,
  last_seen_at timestamptz not null default timezone('utc', now()),
  detected_category_id uuid references public.routine_categories(id) on delete set null,
  confirmed_category_id uuid references public.routine_categories(id) on delete set null,
  parent_google_task_id text,
  position text,
  is_hidden boolean not null default false,
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, google_task_id)
);

create table if not exists public.routine_task_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_task_id uuid not null references public.routine_tasks(id) on delete cascade,
  google_task_id text not null,
  google_task_list_id text not null,
  title text not null,
  notes text,
  status text not null,
  due_date date,
  completed_at timestamptz,
  detected_category_id uuid references public.routine_categories(id) on delete set null,
  confirmed_category_id uuid references public.routine_categories(id) on delete set null,
  raw_json jsonb not null default '{}'::jsonb,
  snapshot_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.routine_task_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_task_id uuid references public.routine_tasks(id) on delete set null,
  google_task_id text not null,
  event_type text not null,
  previous_value jsonb,
  new_value jsonb,
  event_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.routine_weekly_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start_date date not null,
  week_end_date date not null,
  completed_count integer not null default 0,
  prioritized_count integer not null default 0,
  open_count integer not null default 0,
  stale_count integer not null default 0,
  events_count integer not null default 0,
  summary_json jsonb not null default '{}'::jsonb,
  future_ai_summary text,
  generated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, week_start_date)
);

create index if not exists routine_task_lists_user_idx on public.routine_task_lists (user_id);
create index if not exists routine_tasks_user_status_idx on public.routine_tasks (user_id, status);
create index if not exists routine_tasks_user_list_idx on public.routine_tasks (user_id, google_task_list_id);
create index if not exists routine_tasks_user_completed_idx on public.routine_tasks (user_id, completed_at);
create index if not exists routine_task_events_user_event_at_idx on public.routine_task_events (user_id, event_at desc);
create index if not exists routine_task_events_user_type_idx on public.routine_task_events (user_id, event_type);
create index if not exists routine_weekly_reports_user_week_idx on public.routine_weekly_reports (user_id, week_start_date desc);

alter table public.routine_google_connections enable row level security;
alter table public.routine_categories enable row level security;
alter table public.routine_task_lists enable row level security;
alter table public.routine_tasks enable row level security;
alter table public.routine_task_snapshots enable row level security;
alter table public.routine_task_events enable row level security;
alter table public.routine_weekly_reports enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'routine_google_connections',
    'routine_categories',
    'routine_task_lists',
    'routine_tasks',
    'routine_task_snapshots',
    'routine_task_events',
    'routine_weekly_reports'
  ]
  loop
    execute format('drop policy if exists "%1$I_select_own" on public.%1$I', table_name);
    execute format('create policy "%1$I_select_own" on public.%1$I for select using (user_id = auth.uid())', table_name);

    execute format('drop policy if exists "%1$I_insert_own" on public.%1$I', table_name);
    execute format('create policy "%1$I_insert_own" on public.%1$I for insert with check (user_id = auth.uid())', table_name);

    execute format('drop policy if exists "%1$I_update_own" on public.%1$I', table_name);
    execute format('create policy "%1$I_update_own" on public.%1$I for update using (user_id = auth.uid()) with check (user_id = auth.uid())', table_name);

    execute format('drop policy if exists "%1$I_delete_own" on public.%1$I', table_name);
    execute format('create policy "%1$I_delete_own" on public.%1$I for delete using (user_id = auth.uid())', table_name);
  end loop;
end $$;

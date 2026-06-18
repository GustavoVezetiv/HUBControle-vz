create table if not exists public.routine_ai_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  provider text not null default 'gemini',
  model text not null,
  input_summary_json jsonb not null default '{}'::jsonb,
  summary_text text,
  error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, week_start, provider)
);

create index if not exists routine_ai_summaries_user_week_idx
  on public.routine_ai_summaries (user_id, week_start desc);

alter table public.routine_ai_summaries enable row level security;

drop policy if exists "routine_ai_summaries_select_own" on public.routine_ai_summaries;
create policy "routine_ai_summaries_select_own"
  on public.routine_ai_summaries
  for select
  using (user_id = auth.uid());

drop policy if exists "routine_ai_summaries_insert_own" on public.routine_ai_summaries;
create policy "routine_ai_summaries_insert_own"
  on public.routine_ai_summaries
  for insert
  with check (user_id = auth.uid());

drop policy if exists "routine_ai_summaries_update_own" on public.routine_ai_summaries;
create policy "routine_ai_summaries_update_own"
  on public.routine_ai_summaries
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "routine_ai_summaries_delete_own" on public.routine_ai_summaries;
create policy "routine_ai_summaries_delete_own"
  on public.routine_ai_summaries
  for delete
  using (user_id = auth.uid());

alter table public.voice_capture_sessions
  add column if not exists ai_summary text,
  add column if not exists ai_extraction_result jsonb not null default '{}'::jsonb,
  add column if not exists processing_error text,
  add column if not exists processed_at timestamptz;

create table if not exists public.voice_capture_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  voice_capture_session_id uuid not null references public.voice_capture_sessions(id) on delete cascade,
  suggestion_type text not null check (
    suggestion_type in ('task', 'loose_idea', 'reminder', 'uncertainty')
  ),
  title text not null,
  description text,
  suggested_list_name text,
  confidence text not null default 'baixa' check (confidence in ('alta', 'media', 'baixa')),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'archived')),
  raw_data jsonb not null default '{}'::jsonb,
  reviewed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists voice_capture_suggestions_user_status_idx
  on public.voice_capture_suggestions(user_id, status);

create index if not exists voice_capture_suggestions_session_idx
  on public.voice_capture_suggestions(voice_capture_session_id);

drop trigger if exists set_voice_capture_suggestions_updated_at on public.voice_capture_suggestions;
create trigger set_voice_capture_suggestions_updated_at
before update on public.voice_capture_suggestions
for each row execute function public.set_updated_at();

alter table public.voice_capture_suggestions enable row level security;

drop policy if exists "voice_capture_suggestions_select_own" on public.voice_capture_suggestions;
create policy "voice_capture_suggestions_select_own"
  on public.voice_capture_suggestions
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "voice_capture_suggestions_insert_own" on public.voice_capture_suggestions;
create policy "voice_capture_suggestions_insert_own"
  on public.voice_capture_suggestions
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "voice_capture_suggestions_update_own" on public.voice_capture_suggestions;
create policy "voice_capture_suggestions_update_own"
  on public.voice_capture_suggestions
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "voice_capture_suggestions_delete_own" on public.voice_capture_suggestions;
create policy "voice_capture_suggestions_delete_own"
  on public.voice_capture_suggestions
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.voice_capture_suggestions to authenticated;

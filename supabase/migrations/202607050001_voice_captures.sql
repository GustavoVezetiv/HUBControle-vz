insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voice-captures',
  'voice-captures',
  false,
  52428800,
  array[
    'audio/aac',
    'audio/flac',
    'audio/m4a',
    'audio/mp3',
    'audio/mp4',
    'audio/mpeg',
    'audio/ogg',
    'audio/wav',
    'audio/webm',
    'audio/x-m4a',
    'application/octet-stream'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.voice_capture_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_app text not null default 'vozetiv-capture-mobile',
  local_capture_id text not null,
  audio_storage_bucket text not null default 'voice-captures',
  audio_storage_path text not null,
  audio_file_name text,
  audio_content_type text,
  audio_size_bytes bigint not null default 0 check (audio_size_bytes >= 0),
  created_at_mobile timestamptz not null,
  duration_seconds numeric(12, 3) not null check (duration_seconds >= 0),
  target_duration_seconds numeric(12, 3) check (target_duration_seconds is null or target_duration_seconds >= 0),
  status text not null default 'received' check (
    status in ('received', 'transcription_pending', 'transcribing', 'transcribed', 'failed', 'archived')
  ),
  transcription_status text not null default 'not_started' check (
    transcription_status in ('not_started', 'pending', 'processing', 'completed', 'failed')
  ),
  transcription_text text,
  ai_extraction_status text not null default 'not_started' check (
    ai_extraction_status in ('not_started', 'pending', 'processing', 'completed', 'failed')
  ),
  task_review_status text not null default 'not_started' check (
    task_review_status in ('not_started', 'pending', 'ready', 'reviewed', 'dismissed')
  ),
  metadata jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, source_app, local_capture_id)
);

create index if not exists voice_capture_sessions_user_received_idx
  on public.voice_capture_sessions(user_id, received_at desc);

create index if not exists voice_capture_sessions_user_status_idx
  on public.voice_capture_sessions(user_id, status);

create index if not exists voice_capture_sessions_user_local_idx
  on public.voice_capture_sessions(user_id, source_app, local_capture_id);

drop trigger if exists set_voice_capture_sessions_updated_at on public.voice_capture_sessions;
create trigger set_voice_capture_sessions_updated_at
before update on public.voice_capture_sessions
for each row execute function public.set_updated_at();

alter table public.voice_capture_sessions enable row level security;

drop policy if exists "voice_capture_sessions_select_own" on public.voice_capture_sessions;
create policy "voice_capture_sessions_select_own"
  on public.voice_capture_sessions
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "voice_capture_sessions_insert_own" on public.voice_capture_sessions;
create policy "voice_capture_sessions_insert_own"
  on public.voice_capture_sessions
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "voice_capture_sessions_update_own" on public.voice_capture_sessions;
create policy "voice_capture_sessions_update_own"
  on public.voice_capture_sessions
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "voice_capture_sessions_delete_own" on public.voice_capture_sessions;
create policy "voice_capture_sessions_delete_own"
  on public.voice_capture_sessions
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.voice_capture_sessions to authenticated;

drop policy if exists "voice_captures_storage_select_own" on storage.objects;
create policy "voice_captures_storage_select_own"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'voice-captures'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "voice_captures_storage_insert_own" on storage.objects;
create policy "voice_captures_storage_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'voice-captures'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "voice_captures_storage_update_own" on storage.objects;
create policy "voice_captures_storage_update_own"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'voice-captures'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'voice-captures'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "voice_captures_storage_delete_own" on storage.objects;
create policy "voice_captures_storage_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'voice-captures'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

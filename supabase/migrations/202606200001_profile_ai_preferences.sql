alter table public.profiles
  add column if not exists ai_preferences jsonb not null default '{}'::jsonb;

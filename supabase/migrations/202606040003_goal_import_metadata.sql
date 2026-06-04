alter table public.goals
  add column if not exists start_date date,
  add column if not exists category_label text,
  add column if not exists source_label text,
  add column if not exists import_source text;

create index if not exists goals_user_import_source_idx
  on public.goals (user_id, import_source)
  where import_source is not null;

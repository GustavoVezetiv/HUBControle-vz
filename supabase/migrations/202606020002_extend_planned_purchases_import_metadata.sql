alter table public.planned_purchases
  add column if not exists quantity integer check (quantity is null or quantity > 0),
  add column if not exists priority_rank integer check (priority_rank is null or priority_rank >= 0),
  add column if not exists project text,
  add column if not exists external_url text,
  add column if not exists decision_label text,
  add column if not exists import_source text;

create index if not exists planned_purchases_user_external_url_idx
  on public.planned_purchases(user_id, external_url)
  where external_url is not null;

create index if not exists planned_purchases_user_project_idx
  on public.planned_purchases(user_id, project)
  where project is not null;

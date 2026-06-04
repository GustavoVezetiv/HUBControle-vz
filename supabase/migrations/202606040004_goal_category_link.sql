alter table public.goals
  add column if not exists category_id uuid references public.categories(id) on delete set null;

create index if not exists goals_user_category_id_idx
  on public.goals (user_id, category_id)
  where category_id is not null;

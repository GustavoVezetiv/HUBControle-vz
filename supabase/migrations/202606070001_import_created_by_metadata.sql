alter table public.goals
  add column if not exists created_by uuid references auth.users(id) on delete set null;

alter table public.planned_purchases
  add column if not exists created_by uuid references auth.users(id) on delete set null;

create index if not exists goals_created_by_idx
  on public.goals (created_by)
  where created_by is not null;

create index if not exists planned_purchases_created_by_idx
  on public.planned_purchases (created_by)
  where created_by is not null;

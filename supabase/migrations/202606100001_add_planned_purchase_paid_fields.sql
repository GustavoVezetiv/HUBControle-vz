alter table public.planned_purchases
  add column if not exists paid_amount numeric(14, 2) not null default 0 check (paid_amount >= 0),
  add column if not exists purchase_date date;

create index if not exists planned_purchases_user_purchase_date_idx
  on public.planned_purchases(user_id, purchase_date)
  where purchase_date is not null;

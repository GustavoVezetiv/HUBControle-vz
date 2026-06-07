alter table public.income_sources
  add column if not exists recurrence_frequency text,
  add column if not exists recurrence_start_date date,
  add column if not exists recurrence_end_date date,
  add column if not exists recurrence_parent_id uuid references public.income_sources(id) on delete set null,
  add column if not exists recurrence_generated_until date;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'income_sources_recurrence_frequency_check'
      and conrelid = 'public.income_sources'::regclass
  ) then
    alter table public.income_sources
      add constraint income_sources_recurrence_frequency_check
      check (recurrence_frequency is null or recurrence_frequency in ('monthly'));
  end if;
end $$;

create index if not exists income_sources_recurrence_parent_idx
  on public.income_sources(user_id, recurrence_parent_id, expected_date);

create index if not exists income_sources_generated_recurrence_date_name_idx
  on public.income_sources(user_id, recurrence_parent_id, expected_date, lower(name))
  where recurrence_parent_id is not null;

alter table public.profiles
  add column if not exists content_width text not null default 'standard',
  add column if not exists animations_enabled boolean not null default true,
  add column if not exists interactive_cards_enabled boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_content_width_check'
  ) then
    alter table public.profiles
      add constraint profiles_content_width_check
      check (content_width in ('compact', 'standard', 'wide', 'full'));
  end if;
end $$;

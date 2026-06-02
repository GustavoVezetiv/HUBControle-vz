alter table public.profiles
  add column if not exists visual_style text not null default 'classic',
  add column if not exists interface_density text not null default 'comfortable',
  add column if not exists category_badge_style text not null default 'solid';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_visual_style_check'
  ) then
    alter table public.profiles
      add constraint profiles_visual_style_check
      check (visual_style in ('classic', 'minimal', 'colorful', 'glass', 'compact', 'creative'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_interface_density_check'
  ) then
    alter table public.profiles
      add constraint profiles_interface_density_check
      check (interface_density in ('comfortable', 'compact'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_category_badge_style_check'
  ) then
    alter table public.profiles
      add constraint profiles_category_badge_style_check
      check (category_badge_style in ('solid', 'soft', 'outline', 'creative_pill'));
  end if;
end $$;

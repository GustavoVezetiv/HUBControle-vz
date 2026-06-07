alter table public.profiles
  add column if not exists animation_level text not null default 'soft',
  add column if not exists card_effect text not null default 'normal',
  add column if not exists border_style text not null default 'medium';

alter table public.profiles
  drop constraint if exists profiles_visual_style_check,
  add constraint profiles_visual_style_check
  check (visual_style in ('classic', 'minimal', 'modern', 'colorful', 'glass', 'compact', 'creative'));

alter table public.profiles
  drop constraint if exists profiles_interface_density_check,
  add constraint profiles_interface_density_check
  check (interface_density in ('compact', 'standard', 'comfortable'));

alter table public.profiles
  drop constraint if exists profiles_category_badge_style_check,
  add constraint profiles_category_badge_style_check
  check (category_badge_style in ('solid', 'soft', 'outline', 'creative_pill'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_animation_level_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_animation_level_check
      check (animation_level in ('off', 'soft', 'modern', 'flashy'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_card_effect_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_card_effect_check
      check (card_effect in ('normal', 'lifted_hover', 'soft_glow', 'strong_glow'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_border_style_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_border_style_check
      check (border_style in ('subtle', 'medium', 'rounded'));
  end if;
end $$;

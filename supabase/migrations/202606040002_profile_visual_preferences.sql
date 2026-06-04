alter table public.profiles
  add column if not exists card_glow_enabled boolean not null default false,
  add column if not exists surface_radius text not null default 'medium';

alter table public.profiles
  drop constraint if exists profiles_surface_radius_check;

alter table public.profiles
  add constraint profiles_surface_radius_check
  check (surface_radius in ('soft', 'medium', 'rounded'));

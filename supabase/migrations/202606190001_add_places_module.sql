alter type public.category_type add value if not exists 'general';
alter type public.category_type add value if not exists 'leisure';
alter type public.category_type add value if not exists 'places';

create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  description text,
  place_type text not null default 'other' check (
    place_type in ('restaurant', 'bar', 'cafe', 'outing', 'trip', 'event', 'cinema', 'park', 'shopping', 'other')
  ),
  status text not null default 'want_to_go' check (
    status in ('want_to_go', 'planned', 'visited', 'cancelled')
  ),
  city text,
  district text,
  address text,
  google_maps_url text,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  planned_date date,
  visited_date date,
  estimated_cost numeric(14, 2) not null default 0 check (estimated_cost >= 0),
  actual_cost numeric(14, 2) not null default 0 check (actual_cost >= 0),
  rating integer check (rating is null or rating between 1 and 5),
  would_repeat boolean,
  companion text,
  notes text,
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  archive_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists places_user_status_idx on public.places(user_id, status);
create index if not exists places_user_planned_date_idx on public.places(user_id, planned_date);
create index if not exists places_user_visited_date_idx on public.places(user_id, visited_date);
create index if not exists places_user_category_idx on public.places(user_id, category_id);
create index if not exists places_archived_at_idx on public.places(user_id, archived_at);

drop trigger if exists set_places_updated_at on public.places;
create trigger set_places_updated_at
before update on public.places
for each row execute function public.set_updated_at();

alter table public.places enable row level security;

drop policy if exists "places_select_own" on public.places;
create policy "places_select_own"
  on public.places
  for select
  using (user_id = auth.uid());

drop policy if exists "places_insert_own" on public.places;
create policy "places_insert_own"
  on public.places
  for insert
  with check (user_id = auth.uid());

drop policy if exists "places_update_own" on public.places;
create policy "places_update_own"
  on public.places
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "places_delete_own" on public.places;
create policy "places_delete_own"
  on public.places
  for delete
  using (user_id = auth.uid());

alter type public.expected_status add value if not exists 'renegotiated';

alter table public.reimbursements
  add column if not exists renegotiated_into_id uuid references public.reimbursements(id) on delete set null,
  add column if not exists renegotiated_at timestamptz,
  add column if not exists renegotiation_source_ids uuid[] not null default '{}'::uuid[];

create index if not exists reimbursements_renegotiated_into_idx
  on public.reimbursements(user_id, renegotiated_into_id);

create index if not exists reimbursements_renegotiation_sources_idx
  on public.reimbursements using gin (renegotiation_source_ids);

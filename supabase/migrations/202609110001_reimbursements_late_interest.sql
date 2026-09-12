alter table public.reimbursements
  add column if not exists late_interest_enabled boolean not null default false,
  add column if not exists late_interest_rate numeric(9, 4) not null default 0,
  add column if not exists late_interest_frequency text not null default 'monthly',
  add column if not exists late_fee_amount numeric(14, 2) not null default 0,
  add column if not exists interest_start_date date;

alter table public.reimbursements
  drop constraint if exists reimbursements_received_lte_expected,
  drop constraint if exists reimbursements_late_interest_rate_check,
  drop constraint if exists reimbursements_late_fee_amount_check,
  drop constraint if exists reimbursements_late_interest_frequency_check;

alter table public.reimbursements
  add constraint reimbursements_late_interest_rate_check
    check (late_interest_rate >= 0),
  add constraint reimbursements_late_fee_amount_check
    check (late_fee_amount >= 0),
  add constraint reimbursements_late_interest_frequency_check
    check (late_interest_frequency in ('daily', 'monthly'));

comment on column public.reimbursements.received_amount
  is 'Total actually received, including configured late interest or late fee when applicable.';

comment on column public.reimbursements.late_interest_rate
  is 'Percentage applied per configured frequency after the interest start date while the reimbursement remains open.';

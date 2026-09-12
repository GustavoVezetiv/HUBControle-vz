alter table public.accounts_payable
  add column if not exists late_interest_enabled boolean not null default false,
  add column if not exists late_interest_rate numeric(9, 4) not null default 0,
  add column if not exists late_interest_frequency text not null default 'monthly',
  add column if not exists late_fee_amount numeric(14, 2) not null default 0,
  add column if not exists interest_start_date date;

alter table public.accounts_payable
  drop constraint if exists accounts_payable_late_interest_rate_check,
  drop constraint if exists accounts_payable_late_fee_amount_check,
  drop constraint if exists accounts_payable_late_interest_frequency_check;

alter table public.accounts_payable
  add constraint accounts_payable_late_interest_rate_check
    check (late_interest_rate >= 0),
  add constraint accounts_payable_late_fee_amount_check
    check (late_fee_amount >= 0),
  add constraint accounts_payable_late_interest_frequency_check
    check (late_interest_frequency in ('daily', 'monthly'));

comment on column public.accounts_payable.late_interest_rate
  is 'Percentage applied per configured frequency after the interest start date while the account remains open.';

comment on column public.accounts_payable.late_fee_amount
  is 'Optional fixed late fee added once after the interest start date while the account remains open.';
